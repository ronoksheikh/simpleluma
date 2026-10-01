import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useProjectEvents } from '../../lib/realtime';
import { TerminalIcon } from '../icons';

export type DockTab = 'user' | 'agent';

const THEME = {
  background: '#111318',
  foreground: '#e8ecf3',
  cursor: '#5daeff',
  selectionBackground: 'rgb(93 174 255 / 0.35)',
  black: '#111318', red: '#ff7b8b', green: '#7ee0b0', yellow: '#e6edf7', blue: '#5daeff', magenta: '#b4a7ff', cyan: '#7fd8f5', white: '#eff5ff',
  brightBlack: '#5b6b8f', brightRed: '#ff9aa6', brightGreen: '#9cf0c6', brightYellow: '#ffffff', brightBlue: '#8ec5ff', brightMagenta: '#cbc1ff', brightCyan: '#a4e7fb', brightWhite: '#ffffff',
};

function createTerminal(host: HTMLElement, readOnly: boolean): { term: Terminal; fit: () => void; dispose: () => void } {
  const term = new Terminal({ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, theme: THEME, cursorBlink: !readOnly, disableStdin: readOnly, scrollback: 5000, convertEol: readOnly });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host);
  const fit = () => {
    if (host.clientWidth > 0 && host.clientHeight > 0) fitAddon.fit();
  };
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  fit();
  return { term, fit, dispose: () => { observer.disconnect(); term.dispose(); } };
}

/** The agent's commands, live and read-only. */
function AgentTerminal({ projectId, visible }: { projectId: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ReturnType<typeof createTerminal> | null>(null);

  useEffect(() => {
    const created = createTerminal(host.current!, true);
    handle.current = created;
    void api.get<{ data: string }>(`/api/projects/${projectId}/terminal/agent`).then(({ data }) => created.term.write(data));
    return created.dispose;
  }, [projectId]);

  useProjectEvents(projectId, (e) => {
    if (e.type === 'terminal.agent') handle.current?.term.write(String(e.data));
  });

  useEffect(() => {
    if (visible) requestAnimationFrame(() => handle.current?.fit());
  }, [visible]);

  return <div ref={host} className="h-full" aria-label="Director terminal (read only)" />;
}

/** An interactive shell in the project folder. It connects when first shown and keeps running between visits. */
function UserTerminal({ projectId, visible }: { projectId: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ReturnType<typeof createTerminal> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!visible || started.current) return;
    started.current = true;
    const created = createTerminal(host.current!, false);
    handle.current = created;
    let socket: WebSocket | null = null;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal/${projectId}`);
      socket.onopen = () => {
        created.term.reset();
        socket!.send(JSON.stringify({ type: 'resize', cols: created.term.cols, rows: created.term.rows }));
      };
      socket.onmessage = (e) => created.term.write(e.data as string);
      socket.onclose = () => {
        if (!closed) setTimeout(connect, 1500);
      };
    };
    connect();
    created.term.onData((data) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data })));
    created.term.onResize(({ cols, rows }) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'resize', cols, rows })));
    return () => {
      closed = true;
      socket?.close();
      created.dispose();
      started.current = false;
    };
  }, [projectId, visible]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => handle.current?.fit());
  }, [visible]);

  return <div ref={host} className="h-full" aria-label="Your shell terminal" />;
}

/** The terminal as a workspace tab: the Director's commands live, and your own shell in the project folder. */
export function TerminalTab({ projectId, visible }: { projectId: string; visible: boolean }) {
  const [tab, setTab] = useState<DockTab>('agent');
  const pill = (id: DockTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-lg px-3 py-1 text-[12.5px] transition-colors ${tab === id ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-[#111318] text-white" aria-label="Terminal">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
          <TerminalIcon size={15} className="text-white/50" />
          <div role="tablist" aria-label="Terminal" className="flex gap-1">
            {pill('agent', 'Director')}
            {pill('user', 'Your shell')}
          </div>
          <span className="ml-auto hidden text-[11.5px] text-white/35 sm:inline">{tab === 'agent' ? "Live, read-only view of the Director's commands" : 'bash in the project folder · secrets are env vars'}</span>
        </div>
        <div className="min-h-0 flex-1">
          <div className={tab === 'agent' ? 'h-full' : 'hidden'}><AgentTerminal projectId={projectId} visible={visible && tab === 'agent'} /></div>
          <div className={tab === 'user' ? 'h-full' : 'hidden'}><UserTerminal projectId={projectId} visible={visible && tab === 'user'} /></div>
        </div>
      </section>
    </div>
  );
}
