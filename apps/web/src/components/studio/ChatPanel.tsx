import { Button, Spinner, Tooltip } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { sceneLabel, seconds, timeOfDay, tokens } from '../../lib/format';
import { notify } from '../../lib/notify';
import { useStudio } from '../../lib/studio';
import type { ChatMessage, ContextItem } from '../../lib/types';
import {
  AlertIcon, ArrowUpIcon, BrainIcon, CheckIcon, ChevronIcon, CrosshairIcon, FileIcon, FilmIcon, LayersIcon, PaperclipIcon, PlayIcon,
  RefreshIcon, StopIcon, XIcon, ZipIcon,
} from '../icons';
import { LogoMark } from '../Logo';
import { Markdown } from '../Markdown';
import { ToolCard } from './ToolCard';

const ACCEPT = 'image/*,.svg,.pdf,.zip,.html,.htm,.md,.txt,.json,.woff,.woff2,.ttf,.otf,.mp3,.wav,.m4a';

const SUGGESTIONS = [
  { title: 'Logo intro', text: 'Make a 6-second logo intro from my brand files: the mark unfolds, the wordmark settles, a calm hold at the end.' },
  { title: '3D product spin', text: 'A 10-second 3D product teaser with Three.js: soft studio light, a slow orbit and a bold title card.' },
  { title: 'Kinetic type', text: 'A 15-second kinetic typography piece with GSAP for the line "Learn by making", on beat at 120 bpm.' },
  { title: 'Match a reference', text: 'Study the HTML reference I uploaded and recreate its pacing and easing with my brand.' },
];

// Blocks ---------------------------------------------------------------------------------------

type Block =
  | { kind: 'user'; message: ChatMessage }
  | { kind: 'auto'; message: ChatMessage }
  | { kind: 'director'; key: string; messages: ChatMessage[] };

function toBlocks(messages: ChatMessage[]): Block[] {
  const blocks: Block[] = [];
  for (const m of messages) {
    if (m.hidden || m.role === 'tool') continue;
    if (m.role === 'user') {
      blocks.push(m.meta?.kind === 'autocheck' ? { kind: 'auto', message: m } : { kind: 'user', message: m });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'director') last.messages.push(m);
    else blocks.push({ kind: 'director', key: `d${m.id}`, messages: [m] });
  }
  return blocks;
}

// Pieces ---------------------------------------------------------------------------------------

function Thinking({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(live);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(live), [live]);
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, live]);
  const words = text.trim().split(/\s+/).length;
  return (
    <div className="text-[13px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-ink/50 hover:text-ink/80" aria-expanded={open}>
        <BrainIcon size={14} />
        <span className={live ? 'shimmer-text' : ''}>{live ? 'Thinking…' : `Thought for ${words} words`}</span>
        <ChevronIcon size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div ref={box} className="thin-scroll mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap border-l-2 border-lumablue/20 pl-3 text-[12.5px] leading-relaxed text-ink/55">
          {text}
        </div>
      )}
    </div>
  );
}

function ContextChip({ item, onRemove }: { item: ContextItem; onRemove?: () => void }) {
  const label = item.type === 'scene' ? `${item.label ?? sceneLabel(item.path)} · ${seconds(item.start)}–${seconds(item.start + item.duration)}` : `Frame at ${seconds(item.time)}`;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-lumablue/20 bg-lumablue/[0.06] py-1 pl-2 pr-1.5 text-[12px] text-royal">
      {item.type === 'scene' ? <LayersIcon size={13} /> : <CrosshairIcon size={13} />}
      <span className="truncate">{label}</span>
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="grid size-4 place-items-center rounded hover:bg-lumablue/15"><XIcon size={11} /></button>}
    </span>
  );
}

function AttachmentChip({ path, projectId, onRemove }: { path: string; projectId: string; onRemove?: () => void }) {
  const name = path.replace(/^(assets|references)\//, '');
  const image = /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
  return (
    <span className="inline-flex max-w-[220px] items-center gap-2 rounded-lg border border-ink/10 bg-white py-1 pl-1 pr-1.5 text-[12px]">
      <span className="checker grid size-7 shrink-0 place-items-center overflow-hidden rounded-md">
        {image ? <img src={`/api/projects/${projectId}/files/${path}`} alt="" className="max-h-full max-w-full object-contain" /> : /\.zip$/i.test(path) ? <ZipIcon size={14} /> : <FileIcon size={14} className="text-ink/50" />}
      </span>
      <span className="min-w-0 truncate">{name}</span>
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} className="grid size-4 shrink-0 place-items-center rounded text-ink/45 hover:bg-ink/10"><XIcon size={11} /></button>}
    </span>
  );
}

function UserBubble({ message, projectId }: { message: ChatMessage; projectId: string }) {
  const attachments = Array.isArray(message.meta?.attachments) ? (message.meta.attachments as string[]) : [];
  const context = Array.isArray(message.meta?.context) ? (message.meta.context as ContextItem[]) : [];
  return (
    <li className="flex flex-col items-end gap-1.5">
      {(attachments.length > 0 || context.length > 0) && (
        <div className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
          {context.map((c, i) => <ContextChip key={i} item={c} />)}
          {attachments.map((a) => <AttachmentChip key={a} path={a} projectId={projectId} />)}
        </div>
      )}
      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-lumablue/[0.09] px-4 py-2.5 text-[14.5px] leading-relaxed">{message.content}</div>
    </li>
  );
}

function AutoCheck({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const errors = (message.meta?.errors as string[] | undefined) ?? [];
  return (
    <li className="rounded-xl border border-danger/20 bg-danger/[0.04] px-3 py-2 text-[13px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <AlertIcon size={15} className="text-danger" />
        <span className="flex-1">Auto-check caught {errors.length === 1 ? 'an error' : `${errors.length} errors`} · sent to the Director to fix</span>
        <ChevronIcon size={13} className={`text-ink/40 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <pre className="thin-scroll mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-danger">{errors.join('\n')}</pre>}
    </li>
  );
}

function DirectorHeader({ messages }: { messages: ChatMessage[] }) {
  const usage = messages.reduce((n, m) => n + (m.usage ? m.usage.prompt + m.usage.completion : 0), 0);
  return (
    <div className="flex items-center gap-2">
      <LogoMark size={22} className="rounded-md" />
      <span className="text-[13px] font-semibold">Director</span>
      <span className="text-[11.5px] text-ink/40">{timeOfDay(messages[0]!.createdAt)}</span>
      {usage > 0 && <span className="text-[11.5px] text-ink/35">· {tokens(usage)} tokens</span>}
    </div>
  );
}

type TurnItem =
  | { kind: 'thinking' | 'text' | 'failed' | 'note'; key: string; text: string }
  | { kind: 'tool'; key: string; call: NonNullable<ChatMessage['toolCalls']>[number]; startedAt: number };

/** One flat list per turn, so consecutive tool steps stack tightly and text breathes. */
function flatten(messages: ChatMessage[], results?: Map<string | null, ChatMessage>): TurnItem[] {
  const items: TurnItem[] = [];
  for (const m of messages) {
    if (m.reasoning) items.push({ kind: 'thinking', key: `r${m.id}`, text: m.reasoning });
    if (m.content) items.push({ kind: m.failed ? 'failed' : 'text', key: `c${m.id}`, text: m.content });
    if (m.meta?.truncated === true) items.push({ kind: 'note', key: `n${m.id}`, text: "The reply was cut off by the model's length limit." });
    let previous = m.createdAt;
    for (const call of m.toolCalls ?? []) {
      items.push({ kind: 'tool', key: call.id, call, startedAt: previous });
      const r = results?.get(call.id);
      if (r) previous = r.createdAt;
    }
  }
  return items;
}

function DirectorTurn({ messages, results, progress, projectId, live }: {
  messages: ChatMessage[];
  results: Map<string | null, ChatMessage>;
  progress: Record<string, Record<string, unknown>>;
  projectId: string;
  live?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2.5">
      <DirectorHeader messages={messages} />
      <div className="flex flex-col pl-[30px]">
        {flatten(messages, results).map((item, i, all) => {
          const prev = all[i - 1];
          const gap = i === 0 ? '' : item.kind === 'tool' && prev?.kind === 'tool' ? 'mt-1.5' : 'mt-3';
          if (item.kind !== 'tool') {
            if (item.kind === 'thinking') return <div key={item.key} className={gap}><Thinking text={item.text} /></div>;
            if (item.kind === 'text') return <div key={item.key} className={gap}><Markdown text={item.text} /></div>;
            if (item.kind === 'failed') return <div key={item.key} className={`${gap} flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/[0.05] px-3 py-2.5 text-[13.5px] text-danger`}><AlertIcon size={16} className="mt-0.5 shrink-0" />{item.text}</div>;
            return <p key={item.key} className={`${gap} text-[12px] text-ink/45`}>{item.text}</p>;
          }
          const result = results.get(item.call.id);
          return <div key={item.key} className={gap}><ToolCard call={item.call} result={result} progress={progress[item.call.id]} projectId={projectId} startedAt={item.startedAt} /></div>;
        })}
        {live && <div className={messages.length ? 'mt-3' : ''}>{live}</div>}
      </div>
    </li>
  );
}

function LiveTail() {
  const { chat } = useStudio();
  return (
    <div className="flex flex-col gap-2">
      {chat.thinking && <Thinking text={chat.thinking} live />}
      {chat.streaming && <Markdown text={chat.streaming} />}
      {chat.retry ? (
        <p className="flex items-center gap-2 text-[13px] text-ink/55"><RefreshIcon size={14} className="animate-spin" />The provider hiccuped, retrying…</p>
      ) : (
        <p className="flex items-center gap-2 text-[13px]"><span className="pulse-dot size-1.5 rounded-full bg-lumablue" /><span className="shimmer-text">{chat.activity ?? 'Working'}…</span></p>
      )}
    </div>
  );
}

function RunBanner() {
  const { chat, resume } = useStudio();
  const [busy, setBusy] = useState(false);
  const run = chat.run;
  if (chat.running || !run || run.status === 'done') return null;
  const go = async () => {
    setBusy(true);
    await resume();
    setBusy(false);
  };
  const text =
    run.status === 'paused' ? { title: `Paused after ${run.steps} steps`, body: 'Long job: the Director reached the step limit for one run. Its plan and checkpoints are saved.' }
    : run.status === 'interrupted' ? { title: 'Interrupted by a server restart', body: 'Everything up to the last step is saved.' }
    : run.status === 'stopped' ? { title: 'Stopped', body: 'You stopped the Director. Pick up where it left off, or send a new message.' }
    : { title: 'The run failed', body: run.reason ?? 'Something went wrong.' };
  return (
    <li className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${run.status === 'failed' ? 'border-danger/20 bg-danger/[0.04]' : 'border-lumablue/20 bg-lumablue/[0.05]'}`}>
      <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${run.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-lumablue/10 text-lumablue'}`}>
        {run.status === 'failed' ? <AlertIcon size={17} /> : <PlayIcon size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">{text.title}</p>
        <p className="line-clamp-2 text-[12.5px] text-ink/55">{text.body}</p>
      </div>
      <Button size="sm" isPending={busy} onPress={() => void go()}>{run.status === 'failed' ? <><RefreshIcon size={14} />Try again</> : <><PlayIcon size={13} />Continue</>}</Button>
    </li>
  );
}

function Delivered({ renderId }: { renderId: string }) {
  const { projectId, setTab } = useStudio();
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-success/25 bg-success/[0.05] px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success text-white"><CheckIcon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">Video delivered</p>
        <p className="text-[12.5px] text-ink/55">Watch it in Renders or download the MP4.</p>
      </div>
      <Button size="sm" variant="ghost" onPress={() => setTab('renders')}><FilmIcon size={14} />Watch</Button>
      <a className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-lumablue hover:bg-lumablue/10" href={`/api/projects/${projectId}/renders/${renderId}/file?download=1`}>Download</a>
    </li>
  );
}

function EmptyChat() {
  const { send, chat } = useStudio();
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <LogoMark size={52} className="rounded-2xl shadow-[0_12px_32px_-12px_rgb(41_112_236/0.6)]" />
      <div>
        <h2 className="wordmark text-[26px]">What shall we direct?</h2>
        <p className="mt-1.5 text-[14px] text-ink/55">Describe the video. The Director plans it, builds it in code and shows it live on the right. Drop logos, brand kits, zips or an HTML motion reference anywhere here.</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} type="button" disabled={chat.running} onClick={() => void send(s.text)} className="rounded-2xl border border-ink/[0.08] bg-white px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-lumablue/40 hover:shadow-[0_8px_20px_-12px_rgb(41_112_236/0.5)]">
            <div className="text-[13.5px] font-semibold">{s.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink/55">{s.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Composer -------------------------------------------------------------------------------------

export function useUpload() {
  const { projectId, attachToDraft } = useStudio();
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const upload = async (files: File[], toDraft = true) => {
    if (!files.length) return [];
    setUploading(true);
    try {
      const { added } = await api.upload<{ added: Array<{ name: string; path: string }> }>(`/api/projects/${projectId}/attachments`, files);
      await client.invalidateQueries({ queryKey: ['project', projectId] });
      if (toDraft) attachToDraft(added.length > 12 ? added.filter((a) => /\.(svg|png|jpe?g|webp|pdf|md|txt|html?)$/i.test(a.path)).slice(0, 12).map((a) => a.path) : added.map((a) => a.path));
      if (files.some((f) => /\.zip$/i.test(f.name))) notify.success(`Unpacked ${added.length} files into Assets`);
      return added;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not upload the files.');
      return [];
    } finally {
      setUploading(false);
    }
  };
  return { upload, uploading };
}

function Composer() {
  const { projectId, chat, send, stop, draft, setDraft, cancelQueued, registerComposer } = useStudio();
  const { data: me } = useMe();
  const { upload, uploading } = useUpload();
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => registerComposer(input.current), [registerComposer]);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [draft.text]);

  const submit = async () => {
    if (!draft.text.trim() || sending) return;
    setSending(true);
    const ok = await send(draft.text, { attachments: draft.attachments, context: draft.context });
    if (ok) setDraft({ text: '', attachments: [], context: [] });
    setSending(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      void upload(files);
    }
  };

  return (
    <div className="px-4 pb-4 pt-2">
      {me && !me.hasModel && (
        <p className="mb-2 rounded-xl bg-lumablue/[0.06] px-3 py-2 text-[13px]">Connect a model in <Link className="font-medium text-lumablue" to="/setup">Settings</Link> so the Director can work.</p>
      )}
      {chat.queue.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1" aria-label="Queued messages">
          {chat.queue.map((q) => (
            <li key={q.id} className="flex items-center gap-2 rounded-xl bg-ink/[0.04] px-3 py-1.5 text-[12.5px]">
              <span className="pulse-dot size-1.5 rounded-full bg-sky" />
              <span className="min-w-0 flex-1 truncate"><span className="text-ink/45">Queued · </span>{q.text}</span>
              <button type="button" onClick={() => void cancelQueued(q.id)} aria-label="Cancel queued message" className="text-ink/40 hover:text-ink"><XIcon size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-2xl border border-ink/[0.12] bg-white shadow-[0_2px_8px_-4px_rgb(22_24_29/0.08)] transition-colors focus-within:border-lumablue/60 focus-within:shadow-[0_0_0_4px_rgb(41_112_236/0.08)]">
        {(draft.context.length > 0 || draft.attachments.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {draft.context.map((c, i) => <ContextChip key={i} item={c} onRemove={() => setDraft((d) => ({ ...d, context: d.context.filter((_, j) => j !== i) }))} />)}
            {draft.attachments.map((a) => <AttachmentChip key={a} path={a} projectId={projectId} onRemove={() => setDraft((d) => ({ ...d, attachments: d.attachments.filter((x) => x !== a) }))} />)}
          </div>
        )}
        <textarea
          ref={input}
          aria-label="Message the Director"
          placeholder={chat.running ? 'Add a note: the Director reads it at its next step…' : chat.messages.length ? 'Ask for changes…' : 'Describe the video you want…'}
          value={draft.text}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={1}
          className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14.5px] leading-relaxed outline-none placeholder:text-ink/35"
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
          <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <Tooltip delay={400}>
            <Tooltip.Trigger>
              <Button isIconOnly variant="ghost" size="sm" aria-label="Attach files" isPending={uploading} onPress={() => fileInput.current?.click()}><PaperclipIcon size={17} /></Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Images, SVG, PDF, zip, HTML reference, brand docs</Tooltip.Content>
          </Tooltip>
          <span className="hidden text-[11.5px] text-ink/35 sm:inline"><kbd className="font-sans font-medium text-ink/50">Enter</kbd> to send · <kbd className="font-sans font-medium text-ink/50">Shift + Enter</kbd> for a new line</span>
          <span className="flex-1" />
          {chat.running && (
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <Button isIconOnly size="sm" variant="secondary" aria-label="Stop the Director" onPress={() => void stop()}><StopIcon size={14} /></Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Stop</Tooltip.Content>
            </Tooltip>
          )}
          <Button isIconOnly size="sm" aria-label={chat.running ? 'Queue message' : 'Send'} isPending={sending} isDisabled={!draft.text.trim()} onPress={() => void submit()} className="rounded-full">
            <ArrowUpIcon size={17} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Panel ----------------------------------------------------------------------------------------

export function ChatPanel() {
  const { projectId, chat } = useStudio();
  const { upload } = useUpload();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [dragging, setDragging] = useState(false);

  const visible = useMemo(() => chat.messages.filter((m) => !m.hidden), [chat.messages]);
  const blocks = useMemo(() => toBlocks(chat.messages), [chat.messages]);
  const results = useMemo(() => new Map(chat.messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m])), [chat.messages]);

  // A finished final render in the last run: offer it right in the chat.
  const delivered = useMemo(() => {
    if (chat.running || chat.run?.status !== 'done') return null;
    const last = [...chat.messages].reverse().find((m) => m.role === 'tool' && !m.failed && typeof m.meta?.renderId === 'string' && m.runId === chat.run?.id);
    const call = last && chat.messages.find((m) => m.toolCalls?.some((c) => c.id === last.toolCallId))?.toolCalls?.find((c) => c.id === last.toolCallId);
    return call?.function.name === 'render_final' ? (last!.meta!.renderId as string) : null;
  }, [chat.messages, chat.running, chat.run]);

  // Follow new output while the reader is at the bottom; leave them alone when they scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.streaming, chat.thinking, chat.running, chat.activity]);

  const onScroll = () => {
    const el = scroller.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void upload([...e.dataTransfer.files]);
  };

  const lastBlock = blocks[blocks.length - 1];
  const liveInLast = chat.running && lastBlock?.kind === 'director';

  return (
    <section
      className="relative flex h-full min-h-0 flex-col"
      aria-label="Chat with the Director"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <div ref={scroller} onScroll={onScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {!chat.loaded ? (
          <div className="grid h-full place-items-center"><Spinner /></div>
        ) : visible.length === 0 && !chat.running ? (
          <EmptyChat />
        ) : (
          <ol className="mx-auto flex max-w-[760px] flex-col gap-5 px-5 py-5">
            {blocks.map((b) =>
              b.kind === 'user' ? <UserBubble key={b.message.id} message={b.message} projectId={projectId} />
              : b.kind === 'auto' ? <AutoCheck key={b.message.id} message={b.message} />
              : <DirectorTurn key={b.key} messages={b.messages} results={results} progress={chat.progress} projectId={projectId} live={b === lastBlock && liveInLast ? <LiveTail /> : undefined} />,
            )}
            {chat.running && !liveInLast && (
              <li className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2"><LogoMark size={22} className="rounded-md" /><span className="text-[13px] font-semibold">Director</span></div>
                <div className="pl-[30px]"><LiveTail /></div>
              </li>
            )}
            {delivered && <Delivered renderId={delivered} />}
            <RunBanner />
          </ol>
        )}
      </div>
      <Composer />
      {dragging && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-2xl border-2 border-dashed border-lumablue/50 bg-lumablue/[0.06] backdrop-blur-[1px]">
          <div className="text-center">
            <PaperclipIcon size={26} className="mx-auto text-lumablue" />
            <p className="mt-2 text-[14px] font-medium text-royal">Drop to attach</p>
            <p className="text-[12.5px] text-ink/55">Logos, brand kits, zips and HTML references: the Director reads them</p>
          </div>
        </div>
      )}
    </section>
  );
}
