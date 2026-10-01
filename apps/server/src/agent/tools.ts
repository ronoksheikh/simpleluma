import { execFile } from 'node:child_process';
import { readFile as readLocalFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import type { Redactor } from '../lib/redact.js';
import type { ToolSpec } from '../lib/llm.js';
import { commandEnv, safePath, sandboxUser } from '../lib/sandbox.js';
import { readVideoConfig } from '../projects/manifest.js';
import { commitProject, listProjectFiles, projectDir, readProjectFile, removeProjectFile, writeProjectFile } from '../projects/service.js';
import { workingTree } from '../projects/source.js';
import { captureFrame } from '../render/frame.js';
import { inspectImage } from '../render/inspect.js';
import { getRenderById, startRender, waitForRender } from '../render/service.js';
import { createShare } from '../shares/service.js';
import { runAgentCommand } from '../terminal/manager.js';
import { elevenLabsKey } from '../routes/settings.js';
import { DEFAULT_VOICE_MODEL, generateVoice } from '../voice/generate.js';
import { listVoices } from '../voice/elevenlabs.js';
import { config } from '../config.js';
import { transform } from 'esbuild';
import { BRAND_FILE, brandSchema, emptyBrand, readBrand, writeBrand } from '../brand/brand.js';
import { fetchUrl } from './fetch.js';
import { saveCheckpoint } from '../director/checkpoints.js';
import { addMemory, removeMemory } from '../director/memory.js';
import { formatTodos, replaceTodos } from '../director/todos.js';
import { hub } from '../lib/hub.js';
import { checkVideo, formatReport } from '../render/check.js';
import { shootReference } from '../render/reference.js';

const exec = promisify(execFile);

export interface ToolContext {
  projectId: string;
  userId: string;
  runId: string;
  /** The current step of the run (model turns so far). */
  step: number;
  /** Public address of the app, for share links. */
  origin: string;
  secrets: Record<string, string>;
  redactor: Redactor;
  signal: AbortSignal;
  /** Attach data to the tool card while the tool runs (for example the render id). */
  progress(meta: Record<string, unknown>): void;
}

export interface ToolResult {
  text: string;
  failed?: boolean;
  /** Extra data for the tool card in the UI. */
  meta?: Record<string, unknown>;
  /** An image for vision-capable models to look at. */
  image?: { mime: string; base64: string };
}

interface Tool<S extends z.ZodType> {
  spec: ToolSpec;
  schema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

const MAX_TEXT = 60_000;
const fail = (text: string): ToolResult => ({ text, failed: true });
const clip = (text: string, max = MAX_TEXT): string => (text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]` : text);

function define<S extends z.ZodType>(name: string, description: string, parameters: Record<string, unknown>, schema: S, run: Tool<S>['run']): Tool<S> {
  return { spec: { type: 'function', function: { name, description, parameters } }, schema, run };
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required });
const str = (description: string): Record<string, unknown> => ({ type: 'string', description });
const num = (description: string): Record<string, unknown> => ({ type: 'number', description });

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function svgColors(source: string): string[] {
  const found = source.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g) ?? [];
  return [...new Set(found.map((c) => c.toLowerCase()))].slice(0, 24);
}

const listFiles = define('list_files', 'List every file in the project with its size.', obj({}), z.object({}), async (_args, ctx) => {
  const files = (await listProjectFiles(ctx.projectId)).sort();
  const dir = projectDir(ctx.projectId);
  const lines = await Promise.all(files.map(async (f) => `${f}  (${(await stat(resolve(dir, f)).catch(() => ({ size: 0 }))).size} bytes)`));
  return { text: lines.join('\n') || '(no files)' };
});

const readFile = define(
  'read_file',
  'Read a project file. Text files come back as text; PDFs as extracted text; images and SVGs with their size, colours and (when supported) the picture itself.',
  obj({ path: str('Path relative to the project, e.g. scenes/01-intro.js'), start_line: num('First line to return (1-based, optional)'), end_line: num('Last line to return (optional)') }, ['path']),
  z.object({ path: z.string().min(1), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
  async (args, ctx) => {
    const ext = extname(args.path).toLowerCase();
    const dir = projectDir(ctx.projectId);
    if (ext === '.pdf') {
      const file = await safePath(dir, args.path);
      const { stdout } = await exec('pdftotext', ['-layout', file, '-'], { maxBuffer: 16 * 1024 * 1024, env: commandEnv(), ...sandboxUser }).catch(() => ({ stdout: '' }));
      return { text: stdout.trim() ? clip(stdout) : 'This PDF has no extractable text (it may be scanned images).' };
    }
    const data = await readProjectFile(ctx.projectId, args.path);
    const mime = IMAGE_TYPES[ext];
    if (mime) {
      const info = await inspectImage(data, mime).catch(() => null);
      const source = ext === '.svg' ? data.toString('utf8') : '';
      const lines = [`${args.path}: ${info ? `${info.width}×${info.height}px.` : 'image.'}`];
      if (info) lines.push(`Dominant colours: ${info.colors.join(', ')}`);
      if (source) lines.push(`Colours used in the SVG source: ${svgColors(source).join(', ') || 'none found'}`, '', clip(source, 20_000));
      return { text: lines.join('\n'), ...(info ? { image: { mime: 'image/png', base64: info.png } } : {}) };
    }
    if (data.includes(0)) return { text: `${args.path} is a binary file (${data.length} bytes).` };
    const all = data.toString('utf8');
    if (!args.start_line && !args.end_line) return { text: clip(all) };
    const lines = all.split('\n');
    return { text: clip(lines.slice((args.start_line ?? 1) - 1, args.end_line ?? lines.length).join('\n')) };
  },
);

/** Catch mistakes at once: a syntax error in a scene, an invalid video.json or brand.json. */
async function checkAfterWrite(ctx: ToolContext, path: string, content: string): Promise<string> {
  if (/\.(m?js)$/.test(path)) {
    try {
      await transform(content, { loader: 'js', format: 'esm', sourcefile: path, logLevel: 'silent' });
    } catch (e) {
      const first = (e as { errors?: Array<{ text: string; location?: { line: number; column: number; lineText: string } }> }).errors?.[0];
      const where = first?.location ? ` (line ${first.location.line}, column ${first.location.column + 1}: \`${first.location.lineText.trim().slice(0, 120)}\`)` : '';
      return `\nSYNTAX ERROR in ${path}${where}: ${first?.text ?? String(e)}. Fix it now: the scene will not load.`;
    }
    return '';
  }
  if (path === BRAND_FILE) {
    try {
      const parsed = brandSchema.safeParse(JSON.parse(content));
      if (!parsed.success) return `\nWarning: brand.json ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`;
      hub.publish(ctx.projectId, { type: 'brand.changed' });
    } catch (e) {
      return `\nWarning: brand.json is not valid JSON: ${e instanceof Error ? e.message : e}`;
    }
    return '';
  }
  if (path !== 'video.json') return '';
  try {
    await readVideoConfig(workingTree(projectDir(ctx.projectId)));
    return '';
  } catch (e) {
    return `\nWarning: ${e instanceof Error ? e.message : e}`;
  }
}

function diffStat(patch: string): { added: number; removed: number } {
  const lines = patch.split('\n');
  return { added: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, removed: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length };
}

const writeFile = define(
  'write_file',
  'Create a file or replace its whole content.',
  obj({ path: str('Path relative to the project'), content: str('The complete new file content') }, ['path', 'content']),
  z.object({ path: z.string().min(1), content: z.string().max(2_000_000) }),
  async (args, ctx) => {
    const before = await readProjectFile(ctx.projectId, args.path).then((b) => b.toString('utf8')).catch(() => null);
    await writeProjectFile(ctx.projectId, args.path, args.content);
    const patch = createTwoFilesPatch(args.path, args.path, before ?? '', args.content, '', '', { context: 3 });
    const { added, removed } = diffStat(patch);
    const problem = await checkAfterWrite(ctx, args.path, args.content);
    return {
      text: `${before === null ? 'Created' : 'Updated'} ${args.path} (+${added} −${removed}).${problem}`,
      failed: problem.includes('SYNTAX ERROR'),
      meta: { diff: patch, added, removed, created: before === null },
    };
  },
);

const editFile = define(
  'edit_file',
  'Make a small targeted edit: replace one exact piece of text in a file. old_string must match exactly and be unique (add surrounding lines if needed).',
  obj({ path: str('Path relative to the project'), old_string: str('Exact text to replace'), new_string: str('Replacement text'), replace_all: { type: 'boolean', description: 'Replace every occurrence' } }, ['path', 'old_string', 'new_string']),
  z.object({ path: z.string().min(1), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().optional() }),
  async (args, ctx) => {
    const before = (await readProjectFile(ctx.projectId, args.path)).toString('utf8');
    const count = before.split(args.old_string).length - 1;
    if (count === 0) return fail(`old_string was not found in ${args.path}. Read the file again and copy the text exactly, including whitespace.`);
    if (count > 1 && !args.replace_all) return fail(`old_string matches ${count} places in ${args.path}. Include more surrounding lines to make it unique, or set replace_all.`);
    const after = args.replace_all ? before.split(args.old_string).join(args.new_string) : before.replace(args.old_string, () => args.new_string);
    await writeProjectFile(ctx.projectId, args.path, after);
    const patch = createTwoFilesPatch(args.path, args.path, before, after, '', '', { context: 3 });
    const { added, removed } = diffStat(patch);
    const problem = await checkAfterWrite(ctx, args.path, after);
    return { text: `Edited ${args.path} (+${added} −${removed}).${problem}`, failed: problem.includes('SYNTAX ERROR'), meta: { diff: patch, added, removed } };
  },
);

const deleteFile = define('delete_file', 'Delete a file from the project.', obj({ path: str('Path relative to the project') }, ['path']), z.object({ path: z.string().min(1) }), async (args, ctx) => {
  await removeProjectFile(ctx.projectId, args.path);
  return { text: `Deleted ${args.path}.` };
});

const commit = define(
  'commit',
  'Save a version: commit all changes with a clear message. Call after each finished step.',
  obj({ message: str('Short, clear commit message, e.g. "Add logo reveal scene"') }, ['message']),
  z.object({ message: z.string().trim().min(1).max(200) }),
  async (args, ctx) => {
    const sha = await commitProject(ctx.projectId, args.message);
    return { text: sha ? `Committed ${sha.slice(0, 7)}: ${args.message}` : 'Nothing to commit: no files changed.', meta: { sha } };
  },
);

function renderTool(kind: 'preview' | 'final') {
  return define(
    kind === 'preview' ? 'render_preview' : 'render_final',
    kind === 'preview'
      ? 'Render a quick 480p MP4 of the current version. Only scenes that changed are re-rendered.'
      : 'Render the final 1080p MP4 of the current version. Only scenes that changed are re-rendered.',
    obj({}),
    z.object({}),
    async (_args, ctx) => {
      const row = await startRender(ctx.projectId, kind);
      ctx.progress({ renderId: row.id });
      const aborted = new Promise<never>((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('Stopped by the user. The render continues in the background.')), { once: true }));
      await Promise.race([waitForRender(row.id), aborted]);
      const done = getRenderById(row.id)!;
      if (done.status !== 'done') return fail(`Render failed: ${done.error ?? 'unknown error'}`);
      const mb = ((done.sizeBytes ?? 0) / 1e6).toFixed(1);
      return {
        text: `Rendered the ${kind === 'final' ? 'final 1080p' : 'quick 480p'} video (${mb} MB, ${done.chunksTotal - done.chunksCached} of ${done.chunksTotal} chunks rendered, ${done.chunksCached} reused from cache). It is in the Renders tab.`,
        meta: { renderId: done.id },
      };
    },
  );
}

const captureFrameTool = define(
  'capture_frame',
  'Draw a still of the current working tree at a given time, to check your work. Returns an image (if you can see images) and numbers describing it.',
  obj({ time: num('Seconds on the video timeline') }, ['time']),
  z.object({ time: z.number().min(0) }),
  async (args, ctx) => {
    let frame;
    try {
      frame = await captureFrame(ctx.projectId, args.time);
    } catch (e) {
      return fail(`Could not draw the frame:\n${e instanceof Error ? e.message : e}`);
    }
    const { stats } = frame;
    const lines = [
      `Frame at ${frame.time.toFixed(2)}s.`,
      `Content covers ${Math.round(stats.coverage * 100)}% of the frame (background excluded); brightness ${stats.brightness.toFixed(2)}.`,
      stats.bounds ? `Content bounds (x0, y0, x1, y1 as fractions): ${stats.bounds.join(', ')}` : 'The frame is EMPTY: only the background is visible.',
      `Main colours: ${stats.colors.join(', ')}`,
    ];
    return {
      text: lines.join('\n'),
      meta: { imageUrl: `/api/projects/${ctx.projectId}/frames/${frame.name}`, time: frame.time },
      image: { mime: 'image/jpeg', base64: (await readLocalFile(frame.file)).toString('base64') },
    };
  },
);

const runCommand = define(
  'run_command',
  'Run a shell command in the project folder (bash). Output streams live to the user\'s terminal. Use for scripts, file conversion, and calling other APIs with saved secrets from the environment.',
  obj({ command: str('The shell command'), timeout_seconds: num('Stop the command after this many seconds (default 60, max 600)') }, ['command']),
  z.object({ command: z.string().min(1).max(20_000), timeout_seconds: z.number().min(1).max(600).optional() }),
  async (args, ctx) => {
    const result = await runAgentCommand(ctx.projectId, args.command, ctx.secrets, (args.timeout_seconds ?? config.commandTimeoutMs / 1000) * 1000, ctx.signal);
    const output = ctx.redactor.apply(result.output).trim();
    const tail = output.length > 12_000 ? `… [earlier output omitted]\n${output.slice(-12_000)}` : output;
    const status = result.timedOut ? 'The command was stopped because it ran too long.' : `Exit code ${result.exitCode}.`;
    return { text: `${status}\n${tail}`, failed: result.timedOut || result.exitCode !== 0, meta: { exitCode: result.exitCode } };
  },
);

function requireVoiceKey(ctx: ToolContext): string | ToolResult {
  return elevenLabsKey(ctx.userId) ?? fail('No ElevenLabs API key is saved. Ask the user to add one in Settings → ElevenLabs (and press Test, then Save).');
}

const listVoicesTool = define('list_voices', "List the user's ElevenLabs voices.", obj({}), z.object({}), async (_args, ctx) => {
  const key = requireVoiceKey(ctx);
  if (typeof key !== 'string') return key;
  const voices = await listVoices(key);
  return { text: voices.map((v) => `${v.id} | ${v.name} | ${v.category}${v.description ? ` | ${v.description}` : ''}`).join('\n') || 'No voices found.' };
});

const generateVoiceTool = define(
  'generate_voice',
  'Generate a voice-over line with ElevenLabs, with word timings. Saves audio/voice/<name>.mp3 and <name>.json and returns when each word is spoken on the video timeline.',
  obj({
    text: str('What to say'),
    voice_id: str('A voice id from list_voices'),
    name: str('File name for this line, e.g. "intro"'),
    at: num('Seconds on the video timeline where the line starts (default 0)'),
    model: str(`ElevenLabs model id (default ${DEFAULT_VOICE_MODEL})`),
  }, ['text', 'voice_id', 'name']),
  z.object({ text: z.string().min(1).max(5000), voice_id: z.string().min(1), name: z.string().min(1).max(60), at: z.number().min(0).optional(), model: z.string().optional() }),
  async (args, ctx) => {
    const key = requireVoiceKey(ctx);
    if (typeof key !== 'string') return key;
    const { clip, path } = await generateVoice(ctx.projectId, key, { text: args.text, voiceId: args.voice_id, name: args.name, at: args.at ?? 0, model: args.model });
    const words = clip.words.slice(0, 500).map((w) => `${w.text} ${(clip.at + w.start).toFixed(2)}-${(clip.at + w.end).toFixed(2)}`);
    return {
      text: [
        `Saved ${path} (audio/voice/${clip.file}). The line runs ${clip.at.toFixed(2)}s–${(clip.at + clip.duration).toFixed(2)}s on the video timeline.`,
        `Word timings in seconds on the video timeline:`,
        words.join(' | '),
        'Make sure video.json duration covers the end of the line, and time your scenes to these words.',
      ].join('\n'),
      meta: { path, duration: clip.duration },
    };
  },
);

const sharePreview = define(
  'share_preview',
  'Create a public share link for the current version: anyone with the link can watch the live preview without logging in.',
  obj({ expires_in_hours: num('Optional: make the link expire after this many hours') }),
  z.object({ expires_in_hours: z.number().positive().optional() }),
  async (args, ctx) => {
    const share = await createShare(ctx.projectId, { kind: 'version', expiresInHours: args.expires_in_hours });
    const url = `${ctx.origin}/s/${share.token}`;
    return { text: `Share link created: ${url}${share.expiresAt ? ` (expires ${new Date(share.expiresAt).toISOString()})` : ''}`, meta: { shareUrl: url } };
  },
);

const updatePlan = define(
  'update_plan',
  'Write the plan for the current job as a checklist the user sees. Send the FULL list every time (it replaces the old one). Keep exactly one item in_progress while working, and mark items done as soon as they are finished.',
  obj({
    items: {
      type: 'array',
      description: 'Every step of the plan, in order',
      items: obj({ text: str('A short, concrete step, e.g. "Build the logo reveal (0–3s)"'), status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, ['text', 'status']),
    },
  }, ['items']),
  z.object({ items: z.array(z.object({ text: z.string().trim().min(1).max(300), status: z.enum(['pending', 'in_progress', 'done']) })).max(40) }),
  async (args, ctx) => {
    const todos = replaceTodos(ctx.projectId, args.items);
    const done = todos.filter((t) => t.status === 'done').length;
    return { text: `Plan saved (${done}/${todos.length} done):\n${formatTodos(todos)}`, meta: { done, total: todos.length } };
  },
);

const remember = define(
  'remember',
  'Save a lasting note to memory. Use "project" for facts about this video (decisions, the client\'s feedback, what was approved) and "global" for the user\'s preferences that apply to every video (style, tone, things they dislike). Memory is shown to you in every conversation.',
  obj({ content: str('One clear sentence to remember'), scope: { type: 'string', enum: ['project', 'global'], description: 'project (default) or global' } }, ['content']),
  z.object({ content: z.string().trim().min(3).max(2000), scope: z.enum(['project', 'global']).optional() }),
  async (args, ctx) => {
    const m = addMemory(ctx.userId, args.scope === 'global' ? null : ctx.projectId, args.content, 'director');
    return { text: `Remembered (${args.scope ?? 'project'}, id ${m.id}): ${m.content}`, meta: { memoryId: m.id, scope: args.scope ?? 'project' } };
  },
);

const forget = define(
  'forget',
  'Remove a note from memory when it is wrong or out of date (use the id shown in your memory list).',
  obj({ id: str('Memory id') }, ['id']),
  z.object({ id: z.string().min(1) }),
  async (args, ctx) => {
    removeMemory(ctx.userId, args.id);
    return { text: `Forgot memory ${args.id}.` };
  },
);

const checkpointTool = define(
  'checkpoint',
  'Save a checkpoint on a long job: commits the work and records where you are, so you can resume after a restart or when older messages are trimmed. Write what is finished, decisions made, and what comes next.',
  obj({ summary: str('Progress so far, key decisions, and the next steps') }, ['summary']),
  z.object({ summary: z.string().trim().min(10).max(4000) }),
  async (args, ctx) => {
    const c = await saveCheckpoint(ctx.projectId, ctx.runId, ctx.step, args.summary, false);
    return { text: `Checkpoint saved${c.sha ? ` at version ${c.sha.slice(0, 7)}` : ''}.`, meta: { checkpointId: c.id, sha: c.sha } };
  },
);

const checkVideoTool = define(
  'check_video',
  'Health check of the whole video: loads it like the preview, draws sample frames across every scene, and reports load errors, scenes that throw (with the time), empty frames and timeline gaps. Run it after building or changing scenes, and before rendering.',
  obj({}),
  z.object({}),
  async (_args, ctx) => {
    const report = await checkVideo(ctx.projectId);
    return { text: formatReport(report), failed: !report.ok, meta: { check: { ok: report.ok, errors: report.errors, warnings: report.warnings } } };
  },
);

const viewReference = define(
  'view_reference',
  'Watch an HTML motion reference the user uploaded (references/*.html or any .html in assets/): returns a contact sheet of the page at the given seconds, plus its title and scripts. Use it to study the reference\'s layout, pacing and easing, then read its source with read_file for exact timings and colours.',
  obj({ path: str('Path of the HTML file'), times: { type: 'array', items: { type: 'number' }, description: 'Seconds to photograph (up to 9), e.g. [0.5, 1.5, 3, 5]' } }, ['path']),
  z.object({ path: z.string().regex(/\.html?$/i, 'Give an .html file'), times: z.array(z.number().min(0).max(600)).max(9).optional() }),
  async (args, ctx) => {
    await readProjectFile(ctx.projectId, args.path);
    const shot = await shootReference(ctx.projectId, args.path, args.times?.length ? args.times : [0.5, 1.5, 3, 4.5, 6, 8]);
    return {
      text: [
        `${args.path}${shot.title ? ` ("${shot.title}")` : ''}: contact sheet at ${shot.times.map((t) => `${t}s`).join(', ')} (left to right, top to bottom).`,
        shot.duration ? `CSS/Web animations end at about ${shot.duration.toFixed(2)}s.` : '',
        `Scripts: ${shot.scripts.join(', ') || 'none'}`,
      ].filter(Boolean).join('\n'),
      meta: { imageUrl: `/api/projects/${ctx.projectId}/frames/${shot.name}`, times: shot.times },
      image: { mime: 'image/jpeg', base64: (await readLocalFile(shot.file)).toString('base64') },
    };
  },
);

const color = obj({ hex: str('#RRGGBB'), name: str('e.g. "Brand Blue"'), role: { type: 'string', enum: ['primary', 'secondary', 'accent', 'background', 'text', 'gradient', 'avoid'] }, usage: str('Where to use it') }, ['hex', 'role']);
const updateBrand = define(
  'update_brand',
  'Write what you learned about the brand into brand.json (the Brand tab shows it, and you must follow it). Read the user\'s brand files first and use judgement: not every SVG is a logo, not every colour in a file is a brand colour. Fields you send replace the old ones; fields you leave out stay as they are.',
  obj({
    name: str('Brand name'),
    colors: { type: 'array', items: color, description: 'The full colour list. Mark colours the brand forbids (or the user dislikes) as role "avoid".' },
    gradients: { type: 'array', items: { type: 'string' }, description: 'CSS linear-gradient(...) strings' },
    fonts: { type: 'array', items: obj({ family: str('Font family'), role: str('headings, text…') }, ['family']) },
    logos: { type: 'array', items: obj({ path: str('Project path of the logo file'), use: str('When to use this version') }, ['path']) },
    rules: { type: 'array', items: { type: 'string' }, description: 'Must-follow rules, one per item' },
    tone: str('Tone of voice'),
  }),
  z.object({
    name: z.string().max(120).optional(),
    colors: z.array(z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #RRGGBB'), name: z.string().max(80).default(''), role: z.enum(['primary', 'secondary', 'accent', 'background', 'text', 'gradient', 'avoid']), usage: z.string().max(300).default('') })).max(48).optional(),
    gradients: z.array(z.string().max(400)).max(16).optional(),
    fonts: z.array(z.object({ family: z.string().max(80), role: z.string().max(80).default('') })).max(12).optional(),
    logos: z.array(z.object({ path: z.string().max(300), use: z.string().max(200).default('') })).max(24).optional(),
    rules: z.array(z.string().max(400)).max(40).optional(),
    tone: z.string().max(1000).optional(),
  }),
  async (args, ctx) => {
    const files = new Set(await listProjectFiles(ctx.projectId));
    const missing = (args.logos ?? []).filter((l) => !files.has(l.path)).map((l) => l.path);
    if (missing.length) return fail(`These logo files do not exist: ${missing.join(', ')}. Use paths from list_files.`);
    const current = (await readBrand(ctx.projectId)) ?? emptyBrand();
    const defined = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
    const brand = await writeBrand(ctx.projectId, { ...current, ...defined, sources: current.sources }, 'Director: update brand.json');
    return { text: `brand.json updated: ${brand.colors.length} colours, ${brand.logos.length} logos, ${brand.fonts.length} fonts, ${brand.rules.length} rules.`, meta: { brand: true } };
  },
);

const searchFiles = define(
  'search_files',
  'Search the text of project files for a word or regular expression (scenes, scripts, references, docs). Returns matching lines with file and line number.',
  obj({ pattern: str('Text or regular expression'), path: str('Only search under this folder or file (optional)') }, ['pattern']),
  z.object({ pattern: z.string().min(1).max(200), path: z.string().max(300).optional() }),
  async (args, ctx) => {
    let re: RegExp;
    try {
      re = new RegExp(args.pattern, 'i');
    } catch {
      re = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const files = (await listProjectFiles(ctx.projectId)).filter((f) => (!args.path || f.startsWith(args.path)) && /\.(m?js|json|md|txt|html?|css|svg)$/i.test(f));
    const hits: string[] = [];
    for (const f of files) {
      const text = (await readProjectFile(ctx.projectId, f)).toString('utf8');
      text.split('\n').forEach((line, i) => {
        if (hits.length < 200 && re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 200)}`);
      });
    }
    return { text: hits.length ? hits.join('\n') : 'No matches.' };
  },
);

const fetchUrlTool = define(
  'fetch_url',
  'Read a public web page (returns its readable text, title and links) or download a file into the project (save_as, e.g. "assets/hero.jpg" or "assets/logo.svg"). Use it for a brand\'s website, a font, an image or a library the user points to.',
  obj({ url: str('http(s) URL'), save_as: str('Optional project path to save the file to (assets/…)') }, ['url']),
  z.object({ url: z.string().url().max(2000), save_as: z.string().regex(/^(assets|references)\/.+$/, 'Save into assets/ or references/').max(300).optional() }),
  async (args, ctx) => {
    const res = await fetchUrl(args.url, ctx.signal);
    if (args.save_as) {
      await writeProjectFile(ctx.projectId, args.save_as, res.body);
      return { text: `Saved ${args.save_as} (${res.contentType}, ${(res.body.length / 1024).toFixed(0)} KB) from ${res.url}.` };
    }
    return { text: clip(res.text ?? `Binary file (${res.contentType}, ${res.body.length} bytes). Use save_as to keep it.`, 40_000) };
  },
);

export const tools = [
  updatePlan, listFiles, readFile, searchFiles, writeFile, editFile, deleteFile, commit, checkpointTool, updateBrand, fetchUrlTool,
  checkVideoTool, captureFrameTool, viewReference, renderTool('preview'), renderTool('final'), runCommand,
  remember, forget, listVoicesTool, generateVoiceTool, sharePreview,
] as unknown as Array<Tool<z.ZodType>>;

export const toolSpecs = (voiceAvailable: boolean): ToolSpec[] =>
  tools.filter((t) => voiceAvailable || !['list_voices', 'generate_voice'].includes(t.spec.function.name)).map((t) => t.spec);

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolResult> {
  const tool = tools.find((t) => t.spec.function.name === name);
  if (!tool) return fail(`Unknown tool "${name}".`);
  let json: unknown;
  try {
    json = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return fail('The arguments were not valid JSON. Call the tool again with a valid JSON object.');
  }
  const parsed = tool.schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return fail(`Invalid arguments: ${issue.path.join('.') || 'arguments'} ${issue.message}`);
  }
  try {
    const result = await tool.run(parsed.data, ctx);
    return { ...result, text: ctx.redactor.apply(result.text) };
  } catch (e) {
    return fail(ctx.redactor.apply(e instanceof Error ? e.message : String(e)));
  }
}
