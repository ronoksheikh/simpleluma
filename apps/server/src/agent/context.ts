import type { ChatMessage, ToolCall } from '../lib/llm.js';

export const CONTEXT_CHAR_BUDGET = 240_000;

const BULKY_ARGUMENTS = ['content', 'old_string', 'new_string'];

/** Drop the file bodies out of an old tool call: the file itself is still in the project, and `read_file` brings it back. */
function slimToolCall(call: ToolCall): ToolCall {
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    for (const key of BULKY_ARGUMENTS) if (typeof args[key] === 'string' && args[key].length > 300) args[key] = '[omitted: read the file to see it]';
    return { ...call, function: { ...call.function, arguments: JSON.stringify(args) } };
  } catch {
    return call;
  }
}

const TRIMMED_NOTE = '[Earlier messages were removed to save space. The plan, the latest checkpoint and memory in your instructions are current; re-read files when you need details.]';

/**
 * Keep the conversation within the model's context: first shrink old tool calls and outputs, then drop the oldest
 * exchanges whole (the plan, checkpoint and memory in the system prompt carry the job forward).
 */
export function compact(messages: ChatMessage[], budget = CONTEXT_CHAR_BUDGET): void {
  const size = (): number =>
    messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 400) + (m.role === 'assistant' ? JSON.stringify(m.tool_calls ?? []).length : 0), 0);
  for (let i = 1; i < messages.length - 8 && size() > budget; i++) {
    const m = messages[i]!;
    if (m.role === 'tool' && m.content.length > 400) messages[i] = { ...m, content: `${m.content.slice(0, 300)}\n… [output removed to save space]` };
    if (m.role === 'assistant' && m.tool_calls) messages[i] = { ...m, tool_calls: m.tool_calls.map(slimToolCall) };
  }
  if (size() <= budget) return;
  const noted = messages[1]?.role === 'user' && messages[1].content === TRIMMED_NOTE;
  const from = noted ? 2 : 1;
  let removed = 0;
  while (messages.length - from > 12 && size() > budget) {
    messages.splice(from, 1);
    // Never leave tool results without the call that asked for them.
    while (messages[from]?.role === 'tool') messages.splice(from, 1);
    removed++;
  }
  if (removed && !noted) messages.splice(1, 0, { role: 'user', content: TRIMMED_NOTE });
}

