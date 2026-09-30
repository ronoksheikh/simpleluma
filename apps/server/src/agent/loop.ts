import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { hub } from '../lib/hub.js';
import { streamChat, type ChatMessage, type ContentPart, type ToolCall } from '../lib/llm.js';
import { Redactor } from '../lib/redact.js';
import { readVideoConfig } from '../projects/manifest.js';
import { commitProject, listProjectFiles, projectDir, type Project } from '../projects/service.js';
import { workingTree } from '../projects/source.js';
import { activeProfile } from '../routes/models.js';
import { elevenLabsKey, loadSecrets } from '../routes/settings.js';
import { listMessages, saveMessage, toChatMessages } from './messages.js';
import { buildSystemPrompt } from './prompt.js';
import { executeTool, toolSpecs } from './tools.js';

const MAX_STEPS = 40;
const CONTEXT_CHAR_BUDGET = 320_000;

const runs = new Map<string, AbortController>();

export const isRunning = (projectId: string): boolean => runs.has(projectId);

export function stopRun(projectId: string): void {
  runs.get(projectId)?.abort();
}

/** Start the agent on a message. Returns as soon as the run is underway; progress arrives over the WebSocket. */
export function startRun(project: Project, userId: string, text: string, origin: string): void {
  if (runs.has(project.id)) throw conflict('Luma is still working on the previous message.');
  if (!activeProfile(userId)) throw badRequest('Connect a model in Settings first.');
  const controller = new AbortController();
  runs.set(project.id, controller);
  hub.publish(project.id, { type: 'run.start' });
  void run(project, userId, text, origin, controller.signal)
    .catch((e: unknown) => {
      if (controller.signal.aborted) return;
      const message = e instanceof HttpError || e instanceof Error ? e.message : String(e);
      saveMessage(project.id, { role: 'assistant', content: message, failed: true });
    })
    .finally(() => {
      runs.delete(project.id);
      hub.publish(project.id, { type: 'run.end' });
    });
}

async function run(project: Project, userId: string, text: string, origin: string, signal: AbortSignal): Promise<void> {
  const profile = activeProfile(userId)!;
  const secrets = loadSecrets(userId);
  const redactor = new Redactor(secrets);
  const voiceAvailable = elevenLabsKey(userId) !== null;

  await commitProject(project.id, 'Save changes made outside the agent');
  settleUnansweredCalls(project.id);
  saveMessage(project.id, { role: 'user', content: text });

  const dir = projectDir(project.id);
  const system = buildSystemPrompt({
    projectName: project.name,
    video: await readVideoConfig(workingTree(dir)).catch(() => null),
    files: (await listProjectFiles(project.id)).sort(),
    secretNames: Object.keys(secrets),
    voiceAvailable,
  });
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...toChatMessages(listMessages(project.id).filter((m) => !(m.failed && m.role === 'assistant')))];
  let canSeeImages = true;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      compact(messages);
      const turn = await completeTurn();
      if (!turn.content && !turn.toolCalls.length) {
        saveMessage(project.id, { role: 'assistant', content: 'The model returned an empty reply. Try again, or pick another model in Settings.', failed: true });
        return;
      }
      saveMessage(project.id, { role: 'assistant', content: turn.content, toolCalls: turn.toolCalls });
      messages.push({ role: 'assistant', content: turn.content || null, ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}) });
      if (!turn.toolCalls.length) return;

      const images: ContentPart[] = [];
      for (const call of turn.toolCalls) {
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const result = await executeTool(call.function.name, call.function.arguments, {
          projectId: project.id, userId, origin, secrets, redactor, signal,
          progress: (meta) => hub.publish(project.id, { type: 'tool.progress', callId: call.id, meta }),
        });
        saveMessage(project.id, { role: 'tool', toolCallId: call.id, content: result.text, failed: result.failed ?? false, meta: result.meta });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
        if (result.image && canSeeImages) {
          images.push({ type: 'text', text: `Image from ${call.function.name}:` }, { type: 'image_url', image_url: { url: `data:${result.image.mime};base64,${result.image.base64}` } });
        }
      }
      if (images.length) {
        dropOldImages(messages);
        messages.push({ role: 'user', content: images });
      }
    }
    saveMessage(project.id, { role: 'assistant', content: 'I reached my step limit for one message. Say "continue" and I will pick up where I stopped.' });
  } finally {
    settleUnansweredCalls(project.id);
    await commitProject(project.id, `Agent changes: ${text.replace(/\s+/g, ' ').slice(0, 60)}`);
  }

  /** One model turn. A provider that cannot take images gets the conversation again without them. */
  async function completeTurn() {
    const request = () =>
      streamChat(profile, { model: profile.model, messages, tools: toolSpecs(voiceAvailable) }, signal, (delta) => hub.publish(project.id, { type: 'chat.delta', text: delta }));
    try {
      return await request();
    } catch (e) {
      if (!hasImages(messages) || !/image|vision|multimodal|modalit|content/i.test(e instanceof Error ? e.message : '')) throw e;
      canSeeImages = false;
      stripImages(messages);
      return request();
    }
  }
}

function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
}

function stripImages(messages: ChatMessage[]): void {
  messages.forEach((m, i) => {
    if (m.role === 'user' && Array.isArray(m.content)) messages[i] = { role: 'user', content: '[image omitted: this model cannot view images; use the numbers from the tool result]' };
  });
}

/** Keep only the newest image in the conversation: old ones cost many tokens and are out of date. */
function dropOldImages(messages: ChatMessage[]): void {
  messages.forEach((m, i) => {
    if (m.role === 'user' && Array.isArray(m.content)) messages[i] = { role: 'user', content: '[earlier image omitted]' };
  });
}

/** Shrink the oldest tool output when the conversation grows too large for the model's context. */
function compact(messages: ChatMessage[]): void {
  const size = (): number => messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 400), 0);
  for (let i = 1; i < messages.length - 8 && size() > CONTEXT_CHAR_BUDGET; i++) {
    const m = messages[i]!;
    if (m.role === 'tool' && m.content.length > 400) messages[i] = { ...m, content: `${m.content.slice(0, 300)}\n… [output removed to save space]` };
  }
}

/** A stopped or crashed run can leave tool calls without results, which the next request to the model would reject. */
function settleUnansweredCalls(projectId: string): void {
  const all = listMessages(projectId);
  const answered = new Set(all.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
  const last = [...all].reverse().find((m) => m.role === 'assistant' && m.toolCalls);
  for (const call of last?.toolCalls ?? ([] as ToolCall[])) {
    if (!answered.has(call.id)) saveMessage(projectId, { role: 'tool', toolCallId: call.id, content: 'Stopped before this tool finished.', failed: true });
  }
}

export function clearChat(projectId: string): void {
  db.delete(schema.messages).where(eq(schema.messages.projectId, projectId)).run();
}
