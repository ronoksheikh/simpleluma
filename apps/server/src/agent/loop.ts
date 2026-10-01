import { readFile } from 'node:fs/promises';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { describeBrand, readBrand } from '../brand/brand.js';
import { latestCheckpoint, saveCheckpoint } from '../director/checkpoints.js';
import { formatMemories, listMemories } from '../director/memory.js';
import { getDirectorPrompt, getPreferences } from '../director/preferences.js';
import { formatTodos, listTodos } from '../director/todos.js';
import { randomToken } from '../lib/crypto.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { hub } from '../lib/hub.js';
import { estimateTokens, streamChat, type ChatMessage, type ContentPart, type ToolCall, type Usage } from '../lib/llm.js';
import { Redactor } from '../lib/redact.js';
import { readVideoConfig } from '../projects/manifest.js';
import { commitProject, listProjectFiles, projectDir, type Project } from '../projects/service.js';
import { workingTree } from '../projects/source.js';
import { checkVideo } from '../render/check.js';
import { captureFrame } from '../render/frame.js';
import { activeProfile } from '../routes/models.js';
import { elevenLabsKey, loadSecrets } from '../routes/settings.js';
import { listMessages, saveMessage, toChatMessages, type ContextItem, type MessageView } from './messages.js';
import { buildSystemPrompt } from './prompt.js';
import { executeTool, toolSpecs } from './tools.js';

const CONTEXT_CHAR_BUDGET = 240_000;
const CONTINUE_TEXT = 'Continue where you stopped. Check the plan and the latest checkpoint, then carry on with the next step.';
const RESUME_TEXT = 'The server restarted while you were working. Check the plan, the latest checkpoint and the files, then carry on where you stopped.';

export interface UserInput {
  text: string;
  attachments?: string[];
  context?: ContextItem[];
  /** Read by the model, not shown in the chat (Continue). */
  hidden?: boolean;
}

interface Queued extends UserInput {
  id: string;
}

type RunRow = typeof schema.runs.$inferSelect;
type RunStatus = RunRow['status'];

/** A run in progress. It lives on the server: closing the browser does not stop it. */
interface LiveRun {
  id: string;
  controller: AbortController;
  /** What the model is writing right now, for tabs that open mid-step. */
  text: string;
  reasoning: string;
  step: number;
  stepLimit: number;
  queue: Queued[];
  activity: string | null;
}

const live = new Map<string, LiveRun>();

export const isRunning = (projectId: string): boolean => live.has(projectId);

export function stopRun(projectId: string): void {
  live.get(projectId)?.controller.abort();
}

export function runState(projectId: string) {
  const run = live.get(projectId);
  if (!run) return null;
  return { runId: run.id, text: run.text, reasoning: run.reasoning, step: run.step, stepLimit: run.stepLimit, activity: run.activity, queue: run.queue.map(({ id, text }) => ({ id, text })) };
}

export function lastRun(projectId: string): RunRow | null {
  return db.select().from(schema.runs).where(eq(schema.runs.projectId, projectId)).orderBy(desc(schema.runs.startedAt)).limit(1).get() ?? null;
}

export function projectUsage(projectId: string): { prompt: number; completion: number; runs: number } {
  const row = db
    .select({ prompt: sql<number>`coalesce(sum(${schema.runs.promptTokens}), 0)`, completion: sql<number>`coalesce(sum(${schema.runs.completionTokens}), 0)`, runs: sql<number>`count(*)` })
    .from(schema.runs)
    .where(eq(schema.runs.projectId, projectId))
    .get();
  return { prompt: Number(row?.prompt ?? 0), completion: Number(row?.completion ?? 0), runs: Number(row?.runs ?? 0) };
}

const publishQueue = (projectId: string, run: LiveRun): void =>
  hub.publish(projectId, { type: 'queue.changed', queue: run.queue.map(({ id, text }) => ({ id, text })) });

/** Send a message: starts a run, or waits for the next step of the run in progress. */
export function sendMessage(project: Project, userId: string, input: UserInput, origin: string): 'started' | 'queued' {
  const running = live.get(project.id);
  if (running) {
    if (running.queue.length >= 10) throw conflict('Ten messages are already waiting. Wait for the Director to read them.');
    running.queue.push({ ...input, id: randomToken(6) });
    publishQueue(project.id, running);
    return 'queued';
  }
  startRun(project, userId, input, origin);
  return 'started';
}

export function cancelQueued(projectId: string, id: string): void {
  const run = live.get(projectId);
  if (!run) return;
  run.queue = run.queue.filter((q) => q.id !== id);
  publishQueue(projectId, run);
}

/** Pick up after the step limit, a stop, a failure or a restart. */
export function continueRun(project: Project, userId: string, origin: string, text = CONTINUE_TEXT): void {
  if (live.has(project.id)) throw conflict('The Director is already working.');
  startRun(project, userId, { text, hidden: true }, origin);
}

function startRun(project: Project, userId: string, input: UserInput, origin: string): void {
  if (live.has(project.id)) throw conflict('The Director is still working on the previous message.');
  const profile = activeProfile(userId);
  if (!profile) throw badRequest('Connect a model in Settings first.');
  const prefs = getPreferences(userId);
  const row: RunRow = {
    id: randomToken(9), projectId: project.id, status: 'running', reason: null, steps: 0, stepLimit: prefs.stepLimit,
    promptTokens: 0, completionTokens: 0, model: profile.model, origin, startedAt: Date.now(), endedAt: null,
  };
  db.insert(schema.runs).values(row).run();
  const run: LiveRun = { id: row.id, controller: new AbortController(), text: '', reasoning: '', step: 0, stepLimit: prefs.stepLimit, queue: [], activity: null };
  live.set(project.id, run);
  hub.publish(project.id, { type: 'run.start', run: row });

  let status: RunStatus = 'done';
  let reason: string | null = null;
  void execute(project, userId, input, origin, run)
    .then((s) => {
      status = s;
      if (s === 'paused') reason = 'step_limit';
    })
    .catch((e: unknown) => {
      if (run.controller.signal.aborted) {
        status = 'stopped';
        return;
      }
      status = 'failed';
      reason = e instanceof HttpError || e instanceof Error ? e.message : String(e);
      saveMessage(project.id, { role: 'assistant', content: reason, failed: true, runId: run.id });
    })
    .finally(() => {
      if (run.controller.signal.aborted && status === 'done') status = 'stopped';
      // Messages sent during the last step are not lost: they start the next run.
      const leftover = run.queue;
      live.delete(project.id);
      db.update(schema.runs).set({ status, reason, endedAt: Date.now() }).where(eq(schema.runs.id, run.id)).run();
      hub.publish(project.id, { type: 'run.end', run: db.select().from(schema.runs).where(eq(schema.runs.id, run.id)).get() });
      if (leftover.length && status !== 'stopped' && status !== 'failed') {
        const [first, ...rest] = leftover;
        try {
          startRun(project, userId, first!, origin);
          const next = live.get(project.id);
          if (next) {
            next.queue.push(...rest);
            publishQueue(project.id, next);
          }
        } catch {
          // No model any more: the messages stay unsent.
        }
      }
    });
}

async function execute(project: Project, userId: string, input: UserInput, origin: string, run: LiveRun): Promise<RunStatus> {
  const signal = run.controller.signal;
  const profile = activeProfile(userId)!;
  const prefs = getPreferences(userId);
  const secrets = loadSecrets(userId);
  const redactor = new Redactor(secrets);
  const voiceAvailable = elevenLabsKey(userId) !== null;
  const dir = projectDir(project.id);
  let lastText = '';

  await commitProject(project.id, 'Save changes made outside the Director');
  settleUnansweredCalls(project.id);

  const history = listMessages(project.id).filter((m) => !(m.failed && m.role === 'assistant'));
  const messages: ChatMessage[] = [{ role: 'system', content: '' }, ...toChatMessages(history)];
  let canSeeImages = true;
  await addUserMessage(input);

  const systemPrompt = async (): Promise<string> =>
    buildSystemPrompt({
      projectName: project.name,
      video: await readVideoConfig(workingTree(dir)).catch(() => null),
      files: (await listProjectFiles(project.id)).sort(),
      secretNames: Object.keys(secrets),
      voiceAvailable,
      directorPrompt: getDirectorPrompt(userId),
      brand: describeBrand(await readBrand(project.id)),
      memory: formatMemories(listMemories(userId, project.id)),
      plan: formatTodos(listTodos(project.id)),
      checkpoint: latestCheckpoint(project.id),
      stepLimit: run.stepLimit,
    });

  try {
    for (let step = 1; step <= run.stepLimit; step++) {
      if (signal.aborted) return 'stopped';
      for (const queued of run.queue.splice(0)) await addUserMessage(queued);
      publishQueue(project.id, run);

      run.step = step;
      messages[0] = { role: 'system', content: await systemPrompt() };
      compact(messages);
      run.text = '';
      run.reasoning = '';
      setActivity('Thinking');
      const sent = estimateTokens(messages);
      const turn = await completeTurn();
      const usage: Usage = turn.usage ?? { prompt: sent, completion: Math.ceil((turn.content.length + turn.reasoning.length + JSON.stringify(turn.toolCalls).length) / 4), estimated: true };
      db.update(schema.runs)
        .set({ steps: step, promptTokens: sql`${schema.runs.promptTokens} + ${usage.prompt}`, completionTokens: sql`${schema.runs.completionTokens} + ${usage.completion}` })
        .where(eq(schema.runs.id, run.id))
        .run();
      hub.publish(project.id, { type: 'run.progress', runId: run.id, step, stepLimit: run.stepLimit, usage });

      if (!turn.content && !turn.toolCalls.length) {
        if (turn.reasoning) {
          saveMessage(project.id, { role: 'assistant', content: '', reasoning: turn.reasoning, usage, runId: run.id });
          messages.push({ role: 'assistant', content: turn.reasoning.slice(-2000) });
          messages.push({ role: 'user', content: 'Continue: act on your thinking (call a tool or answer).' });
          continue;
        }
        saveMessage(project.id, { role: 'assistant', content: 'The model returned an empty reply. Try again, or pick another model in Settings.', failed: true, runId: run.id });
        return 'failed';
      }
      if (turn.content) lastText = turn.content;
      saveMessage(project.id, { role: 'assistant', content: turn.content, reasoning: turn.reasoning, toolCalls: turn.toolCalls, usage, runId: run.id, meta: turn.finish === 'length' ? { truncated: true } : undefined });
      messages.push({ role: 'assistant', content: turn.content || null, ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}) });
      run.text = '';
      run.reasoning = '';

      if (!turn.toolCalls.length) {
        // The user wrote while this step ran: answer that before finishing.
        if (run.queue.length) continue;
        return 'done';
      }

      const images: ContentPart[] = [];
      let codeChanged = false;
      let checked = false;
      for (const call of turn.toolCalls) {
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        setActivity(activityFor(call));
        const result = await executeTool(call.function.name, call.function.arguments, {
          projectId: project.id, userId, runId: run.id, step, origin, secrets, redactor, signal,
          progress: (meta) => hub.publish(project.id, { type: 'tool.progress', callId: call.id, meta }),
        });
        saveMessage(project.id, { role: 'tool', toolCallId: call.id, content: result.text, failed: result.failed ?? false, meta: result.meta, runId: run.id });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
        if (result.image && canSeeImages) {
          images.push({ type: 'text', text: `Image from ${call.function.name}:` }, { type: 'image_url', image_url: { url: `data:${result.image.mime};base64,${result.image.base64}` } });
        }
        if (changesCode(call)) codeChanged = true;
        if (call.function.name === 'check_video') checked = true;
      }
      if (images.length) {
        dropOldImages(messages);
        messages.push({ role: 'user', content: images });
      }

      if (prefs.autoCheck && codeChanged && !checked && !signal.aborted) await autoCheck();
      if (prefs.checkpointEvery > 0 && step % prefs.checkpointEvery === 0 && !signal.aborted) {
        const todos = formatTodos(listTodos(project.id));
        await saveCheckpoint(project.id, run.id, step, `Automatic checkpoint after ${step} steps.\nPlan:\n${todos}${lastText ? `\nLast note from the Director: ${lastText.slice(0, 600)}` : ''}`, true);
      }
    }
    return 'paused';
  } finally {
    run.activity = null;
    settleUnansweredCalls(project.id);
    await commitProject(project.id, `Director: ${(input.hidden ? 'continue' : input.text).replace(/\s+/g, ' ').slice(0, 60)}`);
  }

  function setActivity(activity: string): void {
    run.activity = activity;
    hub.publish(project.id, { type: 'run.activity', activity });
  }

  async function addUserMessage(m: UserInput): Promise<void> {
    const meta: Record<string, unknown> = {};
    if (m.attachments?.length) meta.attachments = m.attachments;
    if (m.context?.length) meta.context = m.context;
    const saved = saveMessage(project.id, { role: 'user', content: m.text, hidden: m.hidden, runId: run.id, meta: Object.keys(meta).length ? meta : undefined });
    messages.push(...toChatMessages([saved]));
    // A moment the user pointed at: show the model that frame.
    const frames = (m.context ?? []).filter((c): c is Extract<ContextItem, { type: 'frame' }> => c.type === 'frame').slice(0, 3);
    const parts: ContentPart[] = [];
    for (const f of frames) {
      try {
        const still = await captureFrame(project.id, f.time);
        parts.push({ type: 'text', text: `The frame at ${still.time.toFixed(2)}s the user pointed at:` }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${(await readFile(still.file)).toString('base64')}` } });
      } catch {
        // A frame that cannot be drawn is described by the next check instead.
      }
    }
    if (parts.length && canSeeImages) messages.push({ role: 'user', content: parts });
  }

  /** Load the video after code changes and hand any errors straight back, so broken scenes get fixed at once. */
  async function autoCheck(): Promise<void> {
    setActivity('Checking the video');
    const report = await checkVideo(project.id).catch(() => null);
    if (!report) return;
    hub.publish(project.id, { type: 'check.result', ok: report.ok, errors: report.errors, warnings: report.warnings });
    if (report.ok) return;
    const content = [`[Automatic check] The video has errors after your last changes:`, ...report.errors.map((e) => `- ${e}`), ...report.warnings.map((w) => `- Warning: ${w}`), 'Fix the cause, then verify with check_video.'].join('\n');
    const saved = saveMessage(project.id, { role: 'user', content, runId: run.id, meta: { kind: 'autocheck', ok: false, errors: report.errors, warnings: report.warnings } });
    messages.push({ role: 'user', content: saved.content });
  }

  /** One model turn. A provider that cannot take images gets the conversation again without them. */
  async function completeTurn() {
    const request = () =>
      streamChat(profile, { model: profile.model, messages, tools: toolSpecs(voiceAvailable) }, signal, {
        onText: (delta) => {
          run.text += delta;
          hub.publish(project.id, { type: 'chat.delta', text: delta });
        },
        onReasoning: (delta) => {
          run.reasoning += delta;
          hub.publish(project.id, { type: 'chat.reasoning', text: delta });
        },
        onRetry: (attempt, why) => {
          run.text = '';
          run.reasoning = '';
          hub.publish(project.id, { type: 'run.retry', attempt, reason: why.slice(0, 200) });
        },
      });
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

const CODE_FILE = /\.(m?js|json)$/;

function changesCode(call: ToolCall): boolean {
  if (!['write_file', 'edit_file', 'delete_file'].includes(call.function.name)) return false;
  try {
    const { path } = JSON.parse(call.function.arguments) as { path?: string };
    return typeof path === 'string' && CODE_FILE.test(path) && path !== 'brand.json';
  } catch {
    return false;
  }
}

function activityFor(call: ToolCall): string {
  let path = '';
  try {
    path = String((JSON.parse(call.function.arguments) as { path?: string }).path ?? '');
  } catch {
    // keep it generic
  }
  const labels: Record<string, string> = {
    write_file: `Writing ${path}`, edit_file: `Editing ${path}`, read_file: `Reading ${path}`, capture_frame: 'Checking a frame', check_video: 'Checking the video',
    render_preview: 'Rendering a preview', render_final: 'Rendering the final video', run_command: 'Running a command', update_plan: 'Updating the plan',
    view_reference: 'Studying the reference', generate_voice: 'Recording a voice line', checkpoint: 'Saving a checkpoint', remember: 'Saving to memory',
  };
  return labels[call.function.name] ?? call.function.name.replace(/_/g, ' ');
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
export function compact(messages: ChatMessage[]): void {
  const size = (): number =>
    messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 400) + (m.role === 'assistant' ? JSON.stringify(m.tool_calls ?? []).length : 0), 0);
  for (let i = 1; i < messages.length - 8 && size() > CONTEXT_CHAR_BUDGET; i++) {
    const m = messages[i]!;
    if (m.role === 'tool' && m.content.length > 400) messages[i] = { ...m, content: `${m.content.slice(0, 300)}\n… [output removed to save space]` };
    if (m.role === 'assistant' && m.tool_calls) messages[i] = { ...m, tool_calls: m.tool_calls.map(slimToolCall) };
  }
  if (size() <= CONTEXT_CHAR_BUDGET) return;
  const noted = messages[1]?.role === 'user' && messages[1].content === TRIMMED_NOTE;
  const from = noted ? 2 : 1;
  let removed = 0;
  while (messages.length - from > 12 && size() > CONTEXT_CHAR_BUDGET) {
    messages.splice(from, 1);
    // Never leave tool results without the call that asked for them.
    while (messages[from]?.role === 'tool') messages.splice(from, 1);
    removed++;
  }
  if (removed && !noted) messages.splice(1, 0, { role: 'user', content: TRIMMED_NOTE });
}

/** A stopped or crashed run can leave tool calls without results, which the next request to the model would reject. */
function settleUnansweredCalls(projectId: string): void {
  const all = listMessages(projectId);
  const answered = new Set(all.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
  const last = [...all].reverse().find((m: MessageView) => m.role === 'assistant' && m.toolCalls);
  for (const call of last?.toolCalls ?? ([] as ToolCall[])) {
    if (!answered.has(call.id)) saveMessage(projectId, { role: 'tool', toolCallId: call.id, content: 'Stopped before this tool finished.', failed: true });
  }
}

export function clearChat(projectId: string): void {
  db.delete(schema.messages).where(eq(schema.messages.projectId, projectId)).run();
}

/**
 * Runs that were going when the server stopped are marked interrupted. Recent ones (last six hours) resume on
 * their own, once: a long job keeps going after an update or a crash.
 */
export function recoverInterruptedRuns(): void {
  const stale = db.select().from(schema.runs).where(eq(schema.runs.status, 'running')).all();
  db.update(schema.runs).set({ status: 'interrupted', reason: 'server_restart', endedAt: Date.now() }).where(eq(schema.runs.status, 'running')).run();
  const recent = stale.filter((r) => r.startedAt > Date.now() - 6 * 3600_000);
  const latest = new Map<string, RunRow>();
  for (const r of recent) if (!latest.has(r.projectId) || latest.get(r.projectId)!.startedAt < r.startedAt) latest.set(r.projectId, r);
  setTimeout(() => {
    for (const r of latest.values()) {
      const project = db.select().from(schema.projects).where(eq(schema.projects.id, r.projectId)).get();
      if (!project) continue;
      // Do not resume a resumed run: a run that crashes the server would otherwise loop forever.
      if (r.reason === 'resumed') continue;
      try {
        continueRun(project, project.userId, r.origin ?? 'http://localhost:3000', RESUME_TEXT);
        const run = live.get(project.id);
        if (run) db.update(schema.runs).set({ reason: 'resumed' }).where(eq(schema.runs.id, run.id)).run();
      } catch {
        // No model configured any more: leave it for the user.
      }
    }
  }, 3000);
}

/** Token usage per project of a user, newest activity first. */
export function listRunsUsage(userId: string) {
  const rows = db
    .select({
      projectId: schema.projects.id,
      name: schema.projects.name,
      prompt: sql<number>`coalesce(sum(${schema.runs.promptTokens}), 0)`,
      completion: sql<number>`coalesce(sum(${schema.runs.completionTokens}), 0)`,
      runs: sql<number>`count(${schema.runs.id})`,
      steps: sql<number>`coalesce(sum(${schema.runs.steps}), 0)`,
      last: sql<number>`max(${schema.runs.startedAt})`,
    })
    .from(schema.projects)
    .leftJoin(schema.runs, eq(schema.runs.projectId, schema.projects.id))
    .where(eq(schema.projects.userId, userId))
    .groupBy(schema.projects.id)
    .all()
    .map((r) => ({ ...r, prompt: Number(r.prompt), completion: Number(r.completion), runs: Number(r.runs), steps: Number(r.steps), last: r.last ? Number(r.last) : null }));
  const total = rows.reduce((t, r) => ({ prompt: t.prompt + r.prompt, completion: t.completion + r.completion, runs: t.runs + r.runs, steps: t.steps + r.steps }), { prompt: 0, completion: 0, runs: 0, steps: 0 });
  return { total, projects: rows.sort((a, b) => (b.last ?? 0) - (a.last ?? 0)) };
}
