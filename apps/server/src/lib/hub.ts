import type { WebSocket } from 'ws';

export interface HubEvent {
  type: string;
  [key: string]: unknown;
}

export interface HubClient {
  socket: WebSocket;
  userId: string;
  projects: Set<string>;
}

/** Fan-out of live events (chat, render progress, file changes) to the browsers watching a project. */
class Hub {
  private clients = new Set<HubClient>();

  add(socket: WebSocket, userId: string): HubClient {
    const client: HubClient = { socket, userId, projects: new Set() };
    this.clients.add(client);
    return client;
  }

  remove(client: HubClient): void {
    this.clients.delete(client);
  }

  publish(projectId: string, event: HubEvent): void {
    const payload = JSON.stringify({ ...event, projectId });
    for (const client of this.clients) {
      if (client.projects.has(projectId) && client.socket.readyState === client.socket.OPEN) client.socket.send(payload);
    }
  }
}

export const hub = new Hub();
