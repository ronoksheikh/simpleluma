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
}

export interface ProjectDetail {
  id: string;
  name: string;
  updatedAt: number;
  video: VideoConfig | null;
  attachments: Attachment[];
  head: string | null;
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  failed: boolean;
  meta: Record<string, unknown> | null;
  createdAt: number;
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
