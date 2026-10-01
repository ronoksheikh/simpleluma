import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hub } from '../lib/hub.js';
import type { ChatMessage, ToolCall, Usage } from '../lib/llm.js';

type Row = typeof schema.messages.$inferSelect;

/** Something the user pointed at in the preview: a scene, or one moment. */
export type ContextItem =
  | { type: 'scene'; path: string; start: number; duration: number; label?: string }
  | { type: 'frame'; time: number; imageUrl?: string };

export interface MessageView {
  id: number;
  role: Row['role'];
  content: string;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  failed: boolean;
  meta: Record<string, unknown> | null;
  reasoning: string | null;
  usage: Usage | null;
  runId: string | null;
  hidden: boolean;
  createdAt: number;
}

const parse = <T>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const view = (row: Row): MessageView => ({
  id: row.id,
  role: row.role,
  content: row.content,
  toolCalls: parse<ToolCall[]>(row.toolCalls),
  toolCallId: row.toolCallId,
  failed: row.failed,
  meta: parse<Record<string, unknown>>(row.meta),
  reasoning: row.reasoning,
  usage: parse<Usage>(row.usage),
  runId: row.runId,
  hidden: row.hidden,
  createdAt: row.createdAt,
});

export const listMessages = (projectId: string): MessageView[] =>
  db.select().from(schema.messages).where(eq(schema.messages.projectId, projectId)).orderBy(asc(schema.messages.id)).all().map(view);

export interface NewMessage {
  role: Row['role'];
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  failed?: boolean;
  meta?: Record<string, unknown>;
  reasoning?: string;
  usage?: Usage | null;
  runId?: string;
  hidden?: boolean;
}

export function saveMessage(projectId: string, m: NewMessage): MessageView {
  const row = db
    .insert(schema.messages)
    .values({
      projectId,
      role: m.role,
      content: m.content ?? '',
      toolCalls: m.toolCalls?.length ? JSON.stringify(m.toolCalls) : null,
      toolCallId: m.toolCallId ?? null,
      failed: m.failed ?? false,
      meta: m.meta ? JSON.stringify(m.meta) : null,
      reasoning: m.reasoning?.trim() ? m.reasoning : null,
      usage: m.usage ? JSON.stringify(m.usage) : null,
      runId: m.runId ?? null,
      hidden: m.hidden ?? false,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  const saved = view(row);
  hub.publish(projectId, { type: 'chat.message', message: saved });
  return saved;
}

/** What the model reads for a user message: the text, plus the files attached to it and what the user pointed at. */
export function userText(m: Pick<MessageView, 'content' | 'meta'>): string {
  const attachments = Array.isArray(m.meta?.attachments) ? (m.meta.attachments as string[]) : [];
  const context = Array.isArray(m.meta?.context) ? (m.meta.context as ContextItem[]) : [];
  const extra: string[] = [];
  if (attachments.length) extra.push(`[Attached with this message: ${attachments.join(', ')}. Read them before you act.]`);
  for (const c of context) {
    if (c.type === 'scene') extra.push(`[Focus: ${c.path}${c.label ? ` ("${c.label}")` : ''}, ${c.start.toFixed(2)}s–${(c.start + c.duration).toFixed(2)}s on the timeline. Change this scene; keep the others as they are.]`);
    else extra.push(`[Focus: the moment at ${c.time.toFixed(2)}s (a still of it is attached when you can see images).]`);
  }
  return extra.length ? `${m.content}\n\n${extra.join('\n')}` : m.content;
}

/** The stored conversation in the shape the model expects. */
export function toChatMessages(messages: MessageView[]): ChatMessage[] {
  return messages.map((m): ChatMessage => {
    if (m.role === 'user') return { role: 'user', content: userText(m) };
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
    return { role: 'assistant', content: m.content || null, ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}) };
  });
}
