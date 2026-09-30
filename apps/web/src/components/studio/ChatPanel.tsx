import { Button, Spinner, TextArea } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useProjectEvents, type ServerEvent } from '../../lib/realtime';
import type { Attachment, ChatMessage } from '../../lib/types';
import { PaperclipIcon, SendIcon, SparkIcon, StopIcon, XIcon } from '../icons';
import { ToolCard } from './ToolCard';

interface State {
  messages: ChatMessage[];
  streaming: string;
  running: boolean;
  progress: Record<string, Record<string, unknown>>;
}

type Action =
  | { type: 'load'; messages: ChatMessage[]; running: boolean }
  | { type: 'message'; message: ChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'run'; running: boolean }
  | { type: 'progress'; callId: string; meta: Record<string, unknown> };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return { ...state, messages: action.messages, running: action.running, streaming: '' };
    case 'message':
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message], streaming: action.message.role === 'assistant' ? '' : state.streaming };
    case 'delta':
      return { ...state, streaming: state.streaming + action.text };
    case 'run':
      return { ...state, running: action.running, streaming: '' };
    case 'progress':
      return { ...state, progress: { ...state.progress, [action.callId]: action.meta } };
  }
}

const SUGGESTIONS = [
  'Make a 15-second Lumademy logo intro',
  'Explain what you can do and how we should work together',
  'A product teaser with bold kinetic typography and music',
];

export function ChatPanel({ projectId, attachments }: { projectId: string; attachments: Attachment[] }) {
  const client = useQueryClient();
  const [state, dispatch] = useReducer(reducer, { messages: [], streaming: '', running: false, progress: {} });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: hasModel } = useQuery({ queryKey: ['me'], select: (me: { hasModel: boolean } | null) => me?.hasModel ?? false, queryFn: () => api.get<{ hasModel: boolean }>('/api/auth/me') });

  const load = async () => {
    const data = await api.get<{ messages: ChatMessage[]; running: boolean }>(`/api/projects/${projectId}/chat`);
    dispatch({ type: 'load', ...data });
  };
  useEffect(() => void load(), [projectId]);

  useProjectEvents(projectId, (e: ServerEvent) => {
    if (e.type === 'chat.message') dispatch({ type: 'message', message: e.message as ChatMessage });
    else if (e.type === 'chat.delta') dispatch({ type: 'delta', text: String(e.text) });
    else if (e.type === 'run.start') dispatch({ type: 'run', running: true });
    else if (e.type === 'run.end') dispatch({ type: 'run', running: false });
    else if (e.type === 'tool.progress') dispatch({ type: 'progress', callId: String(e.callId), meta: e.meta as Record<string, unknown> });
    else if (e.type === 'socket.open') void load();
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages.length, state.streaming, state.running]);

  const results = useMemo(() => new Map(state.messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m])), [state.messages]);

  const send = async (content = text) => {
    if (!content.trim() || sending || state.running) return;
    setSending(true);
    try {
      await api.post(`/api/projects/${projectId}/chat`, { text: content });
      setText('');
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const { added } = await api.upload<{ added: string[] }>(`/api/projects/${projectId}/attachments`, [...files]);
      await client.invalidateQueries({ queryKey: ['project', projectId] });
      setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${added.map((n) => `assets/${n}`).join(' ')} `);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not attach the files.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeAttachment = async (name: string) => {
    await api.del(`/api/projects/${projectId}/attachments/${encodeURIComponent(name)}`);
    await client.invalidateQueries({ queryKey: ['project', projectId] });
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-3xl bg-white shadow-[0_2px_12px_-4px_rgb(7_23_56/0.1)]" aria-label="Chat">
      <div ref={scroller} className="thin-scroll flex-1 overflow-y-auto px-4 py-4">
        {state.messages.length === 0 && !state.running ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-lumablue/10 text-lumablue"><SparkIcon size={24} /></span>
            <div>
              <h2 className="text-lg font-semibold">What shall we make?</h2>
              <p className="mt-1 text-sm text-night/60">Describe a video. Luma plans it, builds it in code and shows it live.</p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-2xl border border-night/10 px-4 py-2.5 text-left text-sm transition-colors hover:border-lumablue/50 hover:bg-lumablue/5">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {state.messages.filter((m) => m.role !== 'tool').map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="flex justify-end">
                  <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-offwhite px-4 py-2.5 text-[15px]">{m.content}</p>
                </li>
              ) : (
                <li key={m.id} className="flex flex-col gap-2">
                  {m.content && (
                    <p className={`whitespace-pre-wrap text-[15px] leading-relaxed ${m.failed ? 'rounded-2xl bg-danger/10 px-4 py-2.5 text-danger' : ''}`}>{m.content}</p>
                  )}
                  {m.toolCalls?.map((call) => (
                    <ToolCard key={call.id} call={call} result={results.get(call.id)} progress={state.progress[call.id]} projectId={projectId} />
                  ))}
                </li>
              ),
            )}
            {state.streaming && (
              <li><p className="whitespace-pre-wrap text-[15px] leading-relaxed">{state.streaming}</p></li>
            )}
            {state.running && !state.streaming && (
              <li className="flex items-center gap-2 text-sm text-night/55"><Spinner size="sm" /> Working…</li>
            )}
          </ol>
        )}
      </div>

      <div className="border-t border-night/10 p-3">
        {hasModel === false && (
          <p className="mb-2 rounded-xl bg-lumablue/5 px-3 py-2 text-sm">Connect a model in <a className="font-medium text-lumablue" href="/settings">Settings</a> to start.</p>
        )}
        {attachments.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Attachments">
            {attachments.map((a) => (
              <li key={a.name} className="flex items-center gap-1 rounded-full bg-offwhite py-1 pl-3 pr-1.5 text-xs">
                <span className="max-w-32 truncate">{a.name}</span>
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => void removeAttachment(a.name)} className="grid size-4 place-items-center rounded-full text-night/50 hover:bg-night/10"><XIcon size={11} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-night/15 bg-white p-2 focus-within:border-lumablue">
          <input ref={fileInput} type="file" multiple hidden accept="image/*,.svg,.pdf" onChange={(e) => void attach(e.target.files)} />
          <Button isIconOnly variant="ghost" size="sm" aria-label="Attach images, SVGs or PDFs" onPress={() => fileInput.current?.click()}>
            <PaperclipIcon size={18} />
          </Button>
          <TextArea
            aria-label="Message"
            placeholder="Describe the video you want…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none outline-none"
          />
          {state.running ? (
            <Button isIconOnly size="sm" variant="secondary" aria-label="Stop" onPress={() => void api.post(`/api/projects/${projectId}/chat/stop`)}>
              <StopIcon size={16} />
            </Button>
          ) : (
            <Button isIconOnly size="sm" aria-label="Send" isPending={sending} isDisabled={!text.trim()} onPress={() => void send()}>
              <SendIcon size={18} />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
