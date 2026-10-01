import { badRequest } from './errors.js';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Endpoint {
  baseUrl: string;
  apiKey: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** `true`/`false` when the provider says whether the model supports tools, `undefined` when it does not say. */
  tools?: boolean;
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest('The base URL is not a valid URL (for example https://openrouter.ai/api/v1).');
  }
  if (!/^https?:$/.test(url.protocol)) throw badRequest('The base URL must start with http:// or https://.');
  return url.toString().replace(/\/+$/, '');
}

async function request(endpoint: Endpoint, path: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(endpoint.baseUrl)}${path}`, {
      ...init,
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}`, ...init.headers },
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw badRequest('The model server did not answer in time.');
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw badRequest(`Could not reach ${endpoint.baseUrl}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : e}`);
  }
  if (!res.ok) throw badRequest(await describeError(res));
  return res;
}

async function describeError(res: Response): Promise<string> {
  const body = await res.text();
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    detail = (typeof json.error === 'string' ? json.error : json.error?.message) ?? json.message ?? detail;
  } catch {
    // not JSON: keep the raw text
  }
  if (res.status === 401 || res.status === 403) return `The provider rejected the API key (${res.status}). ${detail}`;
  return `The provider answered ${res.status}: ${detail}`;
}

export async function listModels(endpoint: Endpoint): Promise<ModelInfo[]> {
  const res = await request(endpoint, '/models', { method: 'GET' });
  const json = (await res.json()) as { data?: Array<{ id: string; name?: string; supported_parameters?: string[] }> };
  if (!Array.isArray(json.data)) throw badRequest('The provider did not return a model list. Check the base URL.');
  return json.data
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      tools: m.supported_parameters ? m.supported_parameters.includes('tools') : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const PING_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: 'ping',
    description: 'Reply to the user by calling this function.',
    parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
  },
};

/** Ask the model to call a function. Passing proves the key, the model id and tool calling all work. */
export async function testModel(endpoint: Endpoint, model: string): Promise<void> {
  const res = await request(endpoint, '/chat/completions', {
    method: 'POST',
    timeoutMs: 60_000,
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Call the ping function with word "pong". Do not write any text.' }],
      tools: [PING_TOOL],
      tool_choice: 'auto',
    }),
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { tool_calls?: ToolCall[] } }>; error?: { message?: string } };
  if (json.error) throw badRequest(json.error.message ?? 'The model returned an error.');
  if (!json.choices?.[0]?.message?.tool_calls?.length) {
    throw badRequest('The model answered, but did not call the test function. Luma Studio needs a model with tool calling; pick another one.');
  }
}

const STALL_MS = 120_000;
const RETRIES = 3;

export interface Usage {
  prompt: number;
  completion: number;
  /** `true` when the provider did not report usage and the numbers are estimates. */
  estimated?: boolean;
}

export interface AssistantTurn {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  /** Why the model stopped ("stop", "tool_calls", "length"…), when the provider says. */
  finish: string | null;
}

export interface StreamHandlers {
  onText(delta: string): void;
  onReasoning(delta: string): void;
  /** Called before a retry after a transient provider error. */
  onRetry?(attempt: number, reason: string): void;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

/** Errors worth trying again: rate limits, overloaded or restarting providers, dropped connections. */
const transient = (message: string): boolean => /\b(429|500|502|503|504|529)\b|overloaded|rate.?limit|ECONNRESET|socket hang up|terminated|fetch failed|other side closed|stopped responding/i.test(message);

/** One streamed chat completion, retried on transient errors. Text and thinking stream out; tool calls are returned whole. */
export async function streamChat(
  endpoint: Endpoint,
  body: { model: string; messages: ChatMessage[]; tools: ToolSpec[] },
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<AssistantTurn> {
  let usageOption = true;
  for (let attempt = 1; ; attempt++) {
    let streamed = false;
    try {
      return await streamOnce(endpoint, { ...body, ...(usageOption ? { stream_options: { include_usage: true } } : {}) }, signal, {
        onText: (d) => { streamed = true; handlers.onText(d); },
        onReasoning: (d) => { streamed = true; handlers.onReasoning(d); },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (signal.aborted) throw e;
      // A few servers reject `stream_options`: ask again without it.
      if (usageOption && /stream_options|include_usage/i.test(message)) {
        usageOption = false;
        attempt--;
        continue;
      }
      // Once text has reached the user, a retry would repeat it; let the run decide.
      if (streamed || attempt >= RETRIES || !transient(message)) throw e;
      handlers.onRetry?.(attempt, message);
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    }
  }
}

async function streamOnce(endpoint: Endpoint, body: Record<string, unknown>, signal: AbortSignal, handlers: StreamHandlers): Promise<AssistantTurn> {
  // A provider that goes quiet would leave the run hanging: give up when nothing arrives for a while.
  const stall = new AbortController();
  let stalled = false;
  let watchdog: NodeJS.Timeout | undefined;
  const arm = (): void => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      stall.abort();
    }, STALL_MS);
  };
  arm();

  try {
    const res = await request(endpoint, '/chat/completions', {
      method: 'POST',
      signal: AbortSignal.any([signal, stall.signal]),
      body: JSON.stringify({ ...body, stream: true, tool_choice: 'auto' }),
    });
    return await readStream(res, arm, handlers);
  } catch (e) {
    if (stalled) throw badRequest('The model stopped responding. Try again, or pick another model in Settings.');
    throw e;
  } finally {
    clearTimeout(watchdog);
  }
}

/**
 * Splits `<think>…</think>` blocks (used by some open models) out of the visible text, across chunk boundaries.
 */
export class ThinkSplitter {
  private inside = false;
  private pending = '';

  push(text: string): { text: string; reasoning: string } {
    let input = this.pending + text;
    this.pending = '';
    let out = '';
    let thought = '';
    while (input) {
      const tag = this.inside ? '</think>' : '<think>';
      const at = input.indexOf(tag);
      if (at === -1) {
        // Hold back a possible partial tag at the end.
        let keep = 0;
        for (let n = Math.min(tag.length - 1, input.length); n > 0; n--) {
          if (tag.startsWith(input.slice(-n))) {
            keep = n;
            break;
          }
        }
        const body = input.slice(0, input.length - keep);
        this.pending = input.slice(input.length - keep);
        if (this.inside) thought += body;
        else out += body;
        break;
      }
      if (this.inside) thought += input.slice(0, at);
      else out += input.slice(0, at);
      input = input.slice(at + tag.length);
      this.inside = !this.inside;
    }
    return { text: out, reasoning: thought };
  }

  flush(): { text: string; reasoning: string } {
    const rest = this.pending;
    this.pending = '';
    return this.inside ? { text: '', reasoning: rest } : { text: rest, reasoning: '' };
  }
}

async function readStream(res: Response, onChunk: () => void, handlers: StreamHandlers): Promise<AssistantTurn> {
  if (!res.body) throw badRequest('The provider sent an empty response.');

  let content = '';
  let reasoning = '';
  let usage: Usage | null = null;
  let finish: string | null = null;
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  const think = new ThinkSplitter();
  let buffer = '';

  const emit = (part: { text: string; reasoning: string }): void => {
    if (part.text) {
      content += part.text;
      handlers.onText(part.text);
    }
    if (part.reasoning) {
      reasoning += part.reasoning;
      handlers.onReasoning(part.reasoning);
    }
  };

  const handle = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data) as StreamChunk;
    if (chunk.error) throw badRequest(chunk.error.message ?? 'The model returned an error.');
    if (chunk.usage && (chunk.usage.prompt_tokens || chunk.usage.completion_tokens)) {
      usage = { prompt: chunk.usage.prompt_tokens ?? 0, completion: chunk.usage.completion_tokens ?? 0 };
    }
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    const delta = choice?.delta;
    const thought = delta?.reasoning ?? delta?.reasoning_content;
    if (thought) emit({ text: '', reasoning: thought });
    if (delta?.content) emit(think.push(delta.content));
    for (const part of delta?.tool_calls ?? []) {
      // Some providers leave out `index`: a new id starts a new call, anything else continues the last one.
      const index = part.index ?? (part.id ? calls.length : Math.max(0, calls.length - 1));
      const call = (calls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  };

  for await (const piece of res.body as unknown as AsyncIterable<Uint8Array>) {
    onChunk();
    buffer += decoder.decode(piece, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach((l) => handle(l.trim()));
  }
  handle(buffer.trim());
  emit(think.flush());

  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
  return { content: content.trim() ? content : '', reasoning, toolCalls, usage, finish };
}

/** Rough token count for providers that do not report usage (about four characters per token). */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) chars += m.content.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 3000), 0);
    if (m.role === 'assistant' && m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}
