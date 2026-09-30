import { useEffect, useRef } from 'react';

export interface ServerEvent {
  type: string;
  projectId?: string;
  [key: string]: unknown;
}

type Listener = (event: ServerEvent) => void;

/** One WebSocket per tab: reconnects on its own and re-subscribes to the projects being watched. */
class Realtime {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private watched = new Map<string, number>();
  private retry = 0;

  private connect(): void {
    if (this.socket) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      for (const projectId of this.watched.keys()) socket.send(JSON.stringify({ type: 'subscribe', projectId }));
      this.emit({ type: 'socket.open' });
    };
    socket.onmessage = (e) => this.emit(JSON.parse(e.data as string) as ServerEvent);
    socket.onclose = () => {
      this.socket = null;
      if (this.watched.size || this.listeners.size) setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
    };
  }

  private emit(event: ServerEvent): void {
    this.listeners.forEach((fn) => fn(event));
  }

  watch(projectId: string): () => void {
    this.watched.set(projectId, (this.watched.get(projectId) ?? 0) + 1);
    this.connect();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'subscribe', projectId }));
    return () => {
      const n = (this.watched.get(projectId) ?? 1) - 1;
      if (n > 0) return void this.watched.set(projectId, n);
      this.watched.delete(projectId);
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'unsubscribe', projectId }));
    };
  }

  listen(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const realtime = new Realtime();

/** Subscribe to a project's live events while the component is mounted. */
export function useProjectEvents(projectId: string, handler: Listener): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const stopWatching = realtime.watch(projectId);
    const stopListening = realtime.listen((e) => {
      if (e.projectId === projectId || e.type === 'socket.open') latest.current(e);
    });
    return () => {
      stopListening();
      stopWatching();
    };
  }, [projectId]);
}
