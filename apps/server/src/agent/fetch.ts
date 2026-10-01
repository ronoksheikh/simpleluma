import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { badRequest } from '../lib/errors.js';

const MAX_BYTES = 15 * 1024 * 1024;

/** Addresses the Director must never reach: this machine, the private network and cloud metadata. */
export function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL): Promise<void> {
  if (!/^https?:$/.test(url.protocol)) throw badRequest('Only http and https URLs can be fetched.');
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length) throw badRequest(`Could not resolve ${url.hostname}.`);
  if (addresses.some((a) => isPrivate(a.address))) throw badRequest('That address is on a private network and cannot be fetched.');
}

function readable(html: string): { title: string; text: string; links: string[] } {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const links = [...html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 40).map((m) => `${m[2]!.replace(/<[^>]+>/g, '').trim().slice(0, 60)} → ${m[1]}`);
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return { title, text, links };
}

export interface Fetched {
  url: string;
  contentType: string;
  body: Buffer;
  /** Readable text for pages and text files, `null` for binaries. */
  text: string | null;
}

/** Fetch a public URL (following redirects, each checked), at most 15 MB. */
export async function fetchUrl(raw: string, signal: AbortSignal): Promise<Fetched> {
  let url = new URL(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { 'user-agent': 'LumaStudio-Director/1.0', accept: '*/*' } });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url);
      continue;
    }
    break;
  }
  if (!res) throw badRequest('No response.');
  if (!res.ok) throw badRequest(`${url.host} answered ${res.status}.`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw badRequest(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BYTES) throw badRequest(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  let text: string | null = null;
  if (/html/.test(contentType)) {
    const page = readable(body.toString('utf8'));
    text = `${page.title ? `Title: ${page.title}\n` : ''}URL: ${url}\n\n${page.text}${page.links.length ? `\n\nLinks:\n${page.links.join('\n')}` : ''}`;
  } else if (/^text\/|json|xml|javascript|svg/.test(contentType)) {
    text = body.toString('utf8');
  }
  return { url: url.toString(), contentType, body, text };
}
