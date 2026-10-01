export interface VideoConfig {
  width: number;
  height: number;
  fps: number;
  duration: number;
  bpm: number;
  background?: string;
}

export interface Attachment {
  name: string;
  path: string;
  type: string;
  reference: boolean;
}

export interface Usage {
  prompt: number;
  completion: number;
  estimated?: boolean;
}

export interface ProjectUsage {
  prompt: number;
  completion: number;
  runs: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  updatedAt: number;
  video: VideoConfig | null;
  attachments: Attachment[];
  head: string | null;
  running: boolean;
  usage: ProjectUsage;
}

export interface RunInfo {
  id: string;
  projectId: string;
  status: 'running' | 'done' | 'failed' | 'stopped' | 'paused' | 'interrupted';
  reason: string | null;
  steps: number;
  stepLimit: number;
  promptTokens: number;
  completionTokens: number;
  model: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  lastRun: { status: RunInfo['status']; reason: string | null; startedAt: number } | null;
  video: VideoConfig | null;
  usage: ProjectUsage;
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export type ContextItem =
  | { type: 'scene'; path: string; start: number; duration: number; label?: string }
  | { type: 'frame'; time: number; imageUrl?: string };

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  failed: boolean;
  meta: Record<string, unknown> | null;
  reasoning: string | null;
  usage: Usage | null;
  runId: string | null;
  hidden: boolean;
  createdAt: number;
}

export interface Todo {
  id: number;
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface Checkpoint {
  id: string;
  runId: string | null;
  summary: string;
  sha: string | null;
  step: number;
  auto: boolean;
  createdAt: number;
}

export interface Memory {
  id: string;
  projectId: string | null;
  content: string;
  source: 'user' | 'director';
  createdAt: number;
}

export interface LiveState {
  runId: string;
  text: string;
  reasoning: string;
  step: number;
  stepLimit: number;
  activity: string | null;
  queue: Array<{ id: string; text: string }>;
}

export interface ChatSnapshot {
  messages: ChatMessage[];
  running: boolean;
  live: LiveState | null;
  lastRun: RunInfo | null;
  usage: ProjectUsage;
  todos: Todo[];
}

export interface SceneTiming {
  path: string;
  start: number;
  duration: number;
  overlay: boolean;
}

export interface BrandColor {
  name: string;
  hex: string;
  role: 'primary' | 'secondary' | 'accent' | 'background' | 'text' | 'gradient' | 'detected' | 'avoid';
  usage: string;
}

export interface Brand {
  name: string;
  colors: BrandColor[];
  gradients: string[];
  fonts: Array<{ family: string; role: string }>;
  logos: Array<{ path: string; use: string }>;
  rules: string[];
  tone: string;
  sources: string[];
  edited: boolean;
  updatedAt: number;
}

export interface Preferences {
  stepLimit: number;
  autoCheck: boolean;
  checkpointEvery: number;
  showThinking: boolean;
  autoBrand: boolean;
}

export interface DirectorSettings {
  prompt: string;
  custom: boolean;
  defaultPrompt: string;
  preferences: Preferences;
}

export interface RenderView {
  id: string;
  projectId: string;
  kind: 'preview' | 'final';
  status: 'queued' | 'rendering' | 'done' | 'failed';
  commit: string;
  height: number;
  framesDone: number;
  framesTotal: number;
  chunksTotal: number;
  chunksCached: number;
  progress: number;
  etaSeconds: number | null;
  error: string | null;
  sizeBytes: number | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface CommitInfo {
  sha: string;
  message: string;
  date: number;
  files: number;
  insertions: number;
  deletions: number;
}

export interface ShareInfo {
  id: string;
  token: string;
  kind: 'version' | 'render';
  target: string;
  label: string;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface VoiceClip {
  text: string;
  voiceId: string;
  file: string;
  at: number;
  duration: number;
  words: Array<{ text: string; start: number; end: number }>;
}
