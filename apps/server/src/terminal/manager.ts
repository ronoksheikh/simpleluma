import { spawn, type IPty } from 'node-pty';
import { hub } from '../lib/hub.js';
import { Redactor } from '../lib/redact.js';
import { commandEnv, sandboxUser } from '../lib/sandbox.js';
import { projectDir } from '../projects/service.js';

const SCROLLBACK_CHARS = 200_000;
const IDLE_MS = 30 * 60 * 1000;

class Scrollback {
  private text = '';
  append(data: string): void {
    this.text = (this.text + data).slice(-SCROLLBACK_CHARS);
  }
  get value(): string {
    return this.text;
  }
}

const agentView = new Map<string, Scrollback>();

function agentScrollback(projectId: string): Scrollback {
  let s = agentView.get(projectId);
  if (!s) agentView.set(projectId, (s = new Scrollback()));
  return s;
}

/** What the read-only Agent tab shows. */
export const agentTerminalText = (projectId: string): string => agentScrollback(projectId).value;

function emitAgent(projectId: string, data: string): void {
  agentScrollback(projectId).append(data);
  hub.publish(projectId, { type: 'terminal.agent', data });
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export interface CommandResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Run a command for the agent in the project folder. Output streams live to the Agent tab, secrets redacted. */
export function runAgentCommand(projectId: string, command: string, secrets: Record<string, string>, timeoutMs: number, signal: AbortSignal): Promise<CommandResult> {
  const redactor = new Redactor(secrets);
  emitAgent(projectId, `\x1b[38;5;75m$ ${redactor.apply(command)}\x1b[0m\r\n`);
  const pty = spawn('bash', ['-c', command], {
    cwd: projectDir(projectId),
    env: commandEnv(secrets) as Record<string, string>,
    cols: 120,
    rows: 30,
    ...sandboxUser,
  });
  let output = '';
  let timedOut = false;
  pty.onData((data) => {
    const safe = redactor.push(data);
    output += safe;
    emitAgent(projectId, safe);
  });
  const kill = (): void => {
    try {
      process.kill(-pty.pid, 'SIGKILL');
    } catch {
      pty.kill('SIGKILL');
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  if (signal.aborted) kill();
  else signal.addEventListener('abort', kill, { once: true });
  return new Promise((resolve) => {
    pty.onExit(({ exitCode }) => {
      clearTimeout(timer);
      const rest = redactor.flush();
      output += rest;
      emitAgent(projectId, `${rest}\r\n\x1b[2m[${timedOut ? `stopped after ${timeoutMs / 1000}s` : `exit ${exitCode}`}]\x1b[0m\r\n`);
      resolve({ output: stripAnsi(output), exitCode, timedOut });
    });
  });
}

// Interactive terminal -------------------------------------------------------------------------

interface UserTerminal {
  pty: IPty;
  userId: string;
  scrollback: Scrollback;
  listeners: Set<(data: string) => void>;
  idle?: NodeJS.Timeout;
}

const userTerminals = new Map<string, UserTerminal>();

function startUserTerminal(projectId: string, userId: string, secrets: Record<string, string>): UserTerminal {
  const redactor = new Redactor(secrets);
  const pty = spawn('bash', ['--noprofile', '--norc', '-i'], {
    cwd: projectDir(projectId),
    env: { ...commandEnv(secrets), PS1: '\\[\\e[38;5;75m\\]luma\\[\\e[0m\\] $ ' } as Record<string, string>,
    cols: 100,
    rows: 16,
    ...sandboxUser,
  });
  const term: UserTerminal = { pty, userId, scrollback: new Scrollback(), listeners: new Set() };
  let held: NodeJS.Timeout | undefined;
  const send = (text: string): void => {
    if (!text) return;
    term.scrollback.append(text);
    term.listeners.forEach((fn) => fn(text));
  };
  pty.onData((data) => {
    send(redactor.push(data));
    // A held-back tail only waits briefly for the rest of a possible secret.
    clearTimeout(held);
    held = setTimeout(() => send(redactor.flush()), 60);
  });
  pty.onExit(() => {
    clearTimeout(term.idle);
    term.listeners.forEach((fn) => fn('\r\n\x1b[2m[shell closed]\x1b[0m\r\n'));
    if (userTerminals.get(projectId) === term) userTerminals.delete(projectId);
  });
  return term;
}

function touch(term: UserTerminal): void {
  clearTimeout(term.idle);
  term.idle = setTimeout(() => term.pty.kill(), IDLE_MS);
}

/** Attach to the project's shell (starting it if needed). Returns what the socket needs to drive it. */
export function attachUserTerminal(projectId: string, userId: string, secrets: Record<string, string>, onData: (data: string) => void) {
  let term = userTerminals.get(projectId);
  if (!term) {
    term = startUserTerminal(projectId, userId, secrets);
    userTerminals.set(projectId, term);
  }
  touch(term);
  onData(term.scrollback.value);
  term.listeners.add(onData);
  const current = term;
  return {
    write(data: string) {
      touch(current);
      current.pty.write(data);
    },
    resize(cols: number, rows: number) {
      current.pty.resize(Math.max(2, Math.min(500, cols)), Math.max(2, Math.min(200, rows)));
    },
    detach: () => current.listeners.delete(onData),
  };
}

/** Shells keep the secrets they started with, so restart them when secrets change. */
export function resetUserTerminals(userId: string): void {
  for (const term of userTerminals.values()) if (term.userId === userId) term.pty.kill();
}

