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

export interface AssistantTurn {
  content: string;
  toolCalls: ToolCall[];
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
  }>;
  error?: { message?: string };
}

/** One streamed chat completion. `onText` receives text as it arrives; tool calls are returned whole. */
export async function streamChat(
  endpoint: Endpoint,
  body: { model: string; messages: ChatMessage[]; tools: ToolSpec[] },
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<AssistantTurn> {
  const res = await request(endpoint, '/chat/completions', {
    method: 'POST',
    signal,
    body: JSON.stringify({ ...body, stream: true, tool_choice: 'auto' }),
  });
  if (!res.body) throw badRequest('The provider sent an empty response.');

  let content = '';
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buffer = '';

  const handle = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data) as StreamChunk;
    if (chunk.error) throw badRequest(chunk.error.message ?? 'The model returned an error.');
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      content += delta.content;
      onText(delta.content);
    }
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
    buffer += decoder.decode(piece, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach((l) => handle(l.trim()));
  }
  handle(buffer.trim());

  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
  return { content, toolCalls };
}
