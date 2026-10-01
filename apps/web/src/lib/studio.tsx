import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { notify } from './notify';
import { useProjectEvents, type ServerEvent } from './realtime';
import type { ChatMessage, ChatSnapshot, ContextItem, LiveState, ProjectUsage, RunInfo, Todo } from './types';

export interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  at: number;
}

interface ChatState {
  loaded: boolean;
  messages: ChatMessage[];
  /** What the model is writing right now. */
  streaming: string;
  thinking: string;
  running: boolean;
  run: RunInfo | null;
  step: number;
  stepLimit: number;
  activity: string | null;
  retry: string | null;
  queue: LiveState['queue'];
  todos: Todo[];
  usage: ProjectUsage;
  progress: Record<string, Record<string, unknown>>;
  check: CheckResult | null;
}

type Action =
  | { type: 'load'; snapshot: ChatSnapshot }
  | { type: 'message'; message: ChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'run.start'; run: RunInfo }
  | { type: 'run.progress'; step: number; stepLimit: number; prompt: number; completion: number }
  | { type: 'run.end'; run: RunInfo }
  | { type: 'activity'; activity: string | null }
  | { type: 'retry'; reason: string }
  | { type: 'queue'; queue: LiveState['queue'] }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'progress'; callId: string; meta: Record<string, unknown> }
  | { type: 'check'; check: CheckResult };

const initial: ChatState = {
  loaded: false, messages: [], streaming: '', thinking: '', running: false, run: null, step: 0, stepLimit: 60, activity: null, retry: null,
  queue: [], todos: [], usage: { prompt: 0, completion: 0, runs: 0 }, progress: {}, check: null,
};

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'load': {
      const s = action.snapshot;
      return {
        ...state, loaded: true, messages: s.messages, running: s.running, run: s.lastRun, todos: s.todos, usage: s.usage,
        streaming: s.live?.text ?? '', thinking: s.live?.reasoning ?? '', step: s.live?.step ?? s.lastRun?.steps ?? 0,
        stepLimit: s.live?.stepLimit ?? s.lastRun?.stepLimit ?? 60, activity: s.live?.activity ?? null, queue: s.live?.queue ?? [],
      };
    }
    case 'message': {
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      const assistant = action.message.role === 'assistant';
      return { ...state, messages: [...state.messages, action.message], streaming: assistant ? '' : state.streaming, thinking: assistant ? '' : state.thinking, retry: null };
    }
    case 'delta':
      return { ...state, streaming: state.streaming + action.text, retry: null };
    case 'reasoning':
      return { ...state, thinking: state.thinking + action.text, retry: null };
    case 'run.start':
      return { ...state, running: true, run: action.run, step: 0, stepLimit: action.run.stepLimit, streaming: '', thinking: '', activity: 'Thinking', check: null };
    case 'run.progress':
      return {
        ...state, step: action.step, stepLimit: action.stepLimit,
        usage: { ...state.usage, prompt: state.usage.prompt + action.prompt, completion: state.usage.completion + action.completion },
        run: state.run ? { ...state.run, steps: action.step, promptTokens: state.run.promptTokens + action.prompt, completionTokens: state.run.completionTokens + action.completion } : state.run,
      };
    case 'run.end':
      return { ...state, running: false, run: action.run, streaming: '', thinking: '', activity: null, retry: null, queue: [] };
    case 'activity':
      return { ...state, activity: action.activity };
    case 'retry':
      return { ...state, retry: action.reason, streaming: '', thinking: '' };
    case 'queue':
      return { ...state, queue: action.queue };
    case 'todos':
      return { ...state, todos: action.todos };
    case 'progress':
      return { ...state, progress: { ...state.progress, [action.callId]: action.meta } };
    case 'check':
      return { ...state, check: action.check };
  }
}

export type WorkspaceTab = 'preview' | 'plan' | 'brand' | 'assets' | 'renders' | 'terminal' | 'history' | 'memory' | 'audio' | 'code';

export interface Draft {
  text: string;
  attachments: string[];
  context: ContextItem[];
}

interface StudioValue {
  projectId: string;
  chat: ChatState;
  send(text: string, extra?: { attachments?: string[]; context?: ContextItem[] }): Promise<boolean>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  cancelQueued(id: string): Promise<void>;
  /** The composer's attachments and focus chips, so the preview and assets can add to them. */
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  addContext(item: ContextItem): void;
  attachToDraft(paths: string[]): void;
  tab: WorkspaceTab;
  setTab(tab: WorkspaceTab): void;
  /** Ask the preview to jump to a moment. */
  seek(t: number): void;
  onSeek(fn: (t: number) => void): () => void;
  focusComposer(): void;
  registerComposer(el: HTMLTextAreaElement | null): void;
}

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio outside StudioProvider');
  return value;
}

const sameContext = (a: ContextItem, b: ContextItem): boolean =>
  a.type === b.type && (a.type === 'scene' ? a.path === (b as typeof a).path : Math.abs(a.time - (b as Extract<ContextItem, { type: 'frame' }>).time) < 0.05);

export function StudioProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const client = useQueryClient();
  const [chat, dispatch] = useReducer(reducer, initial);
  const [draft, setDraft] = useState<Draft>({ text: '', attachments: [], context: [] });
  const [tab, setTab] = useState<WorkspaceTab>('preview');
  const seekers = useRef(new Set<(t: number) => void>());
  const composer = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      dispatch({ type: 'load', snapshot: await api.get<ChatSnapshot>(`/api/projects/${projectId}/chat`) });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not load the chat.');
    }
  }, [projectId]);
  useEffect(() => void load(), [load]);

  useProjectEvents(projectId, (e: ServerEvent) => {
    switch (e.type) {
      case 'chat.message': return dispatch({ type: 'message', message: e.message as ChatMessage });
      case 'chat.delta': return dispatch({ type: 'delta', text: String(e.text) });
      case 'chat.reasoning': return dispatch({ type: 'reasoning', text: String(e.text) });
      case 'run.start': return dispatch({ type: 'run.start', run: e.run as RunInfo });
      case 'run.progress': {
        const usage = e.usage as { prompt: number; completion: number };
        return dispatch({ type: 'run.progress', step: Number(e.step), stepLimit: Number(e.stepLimit), prompt: usage.prompt, completion: usage.completion });
      }
      case 'run.end': {
        const run = e.run as RunInfo;
        dispatch({ type: 'run.end', run });
        void client.invalidateQueries({ queryKey: ['renders', projectId] });
        void client.invalidateQueries({ queryKey: ['projects'] });
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Luma Studio', { body: run.status === 'paused' ? 'The Director reached its step limit. Press Continue to keep going.' : run.status === 'failed' ? 'The Director stopped with an error.' : 'The Director finished.', icon: '/luma-icon.svg' });
        }
        return;
      }
      case 'run.activity': return dispatch({ type: 'activity', activity: (e.activity as string | null) ?? null });
      case 'run.retry': return dispatch({ type: 'retry', reason: String(e.reason ?? '') });
      case 'queue.changed': return dispatch({ type: 'queue', queue: e.queue as LiveState['queue'] });
      case 'todos.changed': return dispatch({ type: 'todos', todos: e.todos as Todo[] });
      case 'tool.progress': return dispatch({ type: 'progress', callId: String(e.callId), meta: e.meta as Record<string, unknown> });
      case 'check.result': return dispatch({ type: 'check', check: { ok: Boolean(e.ok), errors: (e.errors as string[]) ?? [], warnings: (e.warnings as string[]) ?? [], at: Date.now() } });
      case 'checkpoint': return void client.invalidateQueries({ queryKey: ['checkpoints', projectId] });
      case 'memory.changed': return void client.invalidateQueries({ queryKey: ['memories', projectId] });
      case 'brand.changed': return void client.invalidateQueries({ queryKey: ['brand', projectId] });
      case 'socket.open': return void load();
    }
  });

  const send = useCallback(
    async (text: string, extra: { attachments?: string[]; context?: ContextItem[] } = {}) => {
      if (!text.trim()) return false;
      try {
        if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
        const res = await api.post<{ queued: boolean }>(`/api/projects/${projectId}/chat`, { text, attachments: extra.attachments?.length ? extra.attachments : undefined, context: extra.context?.length ? extra.context : undefined });
        if (res.queued) notify.success('Queued: the Director reads it at its next step.');
        return true;
      } catch (e) {
        notify.error(e instanceof Error ? e.message : 'Could not send the message.');
        return false;
      }
    },
    [projectId],
  );

  const value = useMemo<StudioValue>(
    () => ({
      projectId,
      chat,
      send,
      stop: async () => void (await api.post(`/api/projects/${projectId}/chat/stop`).catch(() => undefined)),
      resume: async () => {
        try {
          await api.post(`/api/projects/${projectId}/chat/continue`);
        } catch (e) {
          notify.error(e instanceof Error ? e.message : 'Could not continue.');
        }
      },
      cancelQueued: async (id) => void (await api.del(`/api/projects/${projectId}/chat/queue/${id}`).catch(() => undefined)),
      draft,
      setDraft,
      addContext: (item) => {
        setDraft((d) => ({ ...d, context: d.context.some((c) => sameContext(c, item)) ? d.context : [...d.context, item].slice(-8) }));
        composer.current?.focus();
      },
      attachToDraft: (paths) => setDraft((d) => ({ ...d, attachments: [...new Set([...d.attachments, ...paths])].slice(0, 40) })),
      tab,
      setTab,
      seek: (t) => seekers.current.forEach((fn) => fn(t)),
      onSeek: (fn) => {
        seekers.current.add(fn);
        return () => seekers.current.delete(fn);
      },
      focusComposer: () => composer.current?.focus(),
      registerComposer: (el) => {
        composer.current = el;
      },
    }),
    [projectId, chat, send, draft, tab],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
