import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hub } from '../lib/hub.js';
import type { ChatMessage, ToolCall } from '../lib/llm.js';

type Row = typeof schema.messages.$inferSelect;

export interface MessageView {
  id: number;
  role: Row['role'];
  content: string;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  failed: boolean;
  meta: Record<string, unknown> | null;
  createdAt: number;
}

const view = (row: Row): MessageView => ({
  id: row.id,
  role: row.role,
  content: row.content,
  toolCalls: row.toolCalls ? (JSON.parse(row.toolCalls) as ToolCall[]) : null,
  toolCallId: row.toolCallId,
  failed: row.failed,
  meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
  createdAt: row.createdAt,
});

export const listMessages = (projectId: string): MessageView[] =>
  db.select().from(schema.messages).where(eq(schema.messages.projectId, projectId)).orderBy(asc(schema.messages.id)).all().map(view);

export function saveMessage(
  projectId: string,
  m: { role: Row['role']; content?: string; toolCalls?: ToolCall[]; toolCallId?: string; failed?: boolean; meta?: Record<string, unknown> },
): MessageView {
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
      createdAt: Date.now(),
    })
    .returning()
    .get();
  const saved = view(row);
  hub.publish(projectId, { type: 'chat.message', message: saved });
  return saved;
}

/** The stored conversation in the shape the model expects. */
export function toChatMessages(messages: MessageView[]): ChatMessage[] {
  return messages.map((m): ChatMessage => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
    return { role: 'assistant', content: m.content || null, ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}) };
  });
}
