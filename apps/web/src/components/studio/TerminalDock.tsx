import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { useProjectEvents } from '../../lib/realtime';
import { ChevronIcon, TerminalIcon } from '../icons';

export type DockTab = 'user' | 'agent';

const THEME = {
  background: '#071738',
  foreground: '#eff5ff',
  cursor: '#5daeff',
  selectionBackground: 'rgb(93 174 255 / 0.35)',
  black: '#071738', red: '#ff7b8b', green: '#7ee0b0', yellow: '#e6edf7', blue: '#5daeff', magenta: '#b4a7ff', cyan: '#7fd8f5', white: '#eff5ff',
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

  return <div ref={host} className="h-full" aria-label="Agent terminal (read only)" />;
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

  return <div ref={host} className="h-full" aria-label="Terminal" />;
}

interface Props {
  projectId: string;
  open: boolean;
  tab: DockTab;
  onOpen: (open: boolean) => void;
  onTab: (tab: DockTab) => void;
}

export function TerminalDock({ projectId, open, tab, onOpen, onTab }: Props) {
  const pill = (id: DockTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => { onTab(id); onOpen(true); }}
      className={`rounded-lg px-3 py-1 text-sm transition-colors ${tab === id && open ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'}`}
    >
      {label}
    </button>
  );

  return (
    <section className="overflow-hidden rounded-3xl bg-night text-white" aria-label="Terminal dock">
      <div className="flex h-11 items-center gap-2 px-4">
        <TerminalIcon size={16} className="text-white/60" />
        <div role="tablist" aria-label="Terminal" className="flex gap-1">
          {pill('user', 'Terminal')}
          {pill('agent', 'Agent')}
        </div>
        <span className="ml-2 hidden text-xs text-white/40 sm:inline">{tab === 'agent' ? "Live view of the agent's commands" : 'Working inside the project folder'}</span>
        <button type="button" onClick={() => onOpen(!open)} aria-label={open ? 'Collapse terminal' : 'Expand terminal'} aria-expanded={open} className="ml-auto grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white">
          <ChevronIcon size={16} className={open ? 'rotate-90' : '-rotate-90'} />
        </button>
      </div>
      <div className={open ? 'h-56' : 'hidden'}>
        <div className={tab === 'user' ? 'h-full' : 'hidden'}><UserTerminal projectId={projectId} visible={open && tab === 'user'} /></div>
        <div className={tab === 'agent' ? 'h-full' : 'hidden'}><AgentTerminal projectId={projectId} visible={open && tab === 'agent'} /></div>
      </div>
    </section>
  );
}
