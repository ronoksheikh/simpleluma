/** Shape of a project's `video.json`. */
export interface VideoConfig {
  width: number;
  height: number;
  fps: number;
  /** Total length in seconds. */
  duration: number;
  bpm: number;
  /** CSS colour painted behind all scenes. */
  background?: string;
}

export interface Word {
  text: string;
  /** Seconds, relative to the start of the audio file. */
  start: number;
  end: number;
}

/** Contents of `audio/voice/<name>.json`, written by the `generate_voice` tool. */
export interface VoiceClip {
  text: string;
  voiceId: string;
  /** Audio file name inside `audio/voice/`. */
  file: string;
  /** Seconds on the video timeline where the clip starts. */
  at: number;
  duration: number;
  words: Word[];
}

/** A voice word placed on the video timeline (seconds). */
export interface TimelineWord extends Word {
  clip: string;
}

export interface VoiceTrack {
  clips: Array<VoiceClip & { name: string }>;
  words: TimelineWord[];
}

export interface Frame {
  /** Seconds on the video timeline. */
  time: number;
  /** Seconds since the scene started (same as the second argument of `draw`). */
  t: number;
  /** Scene length in seconds. */
  duration: number;
  /** `t / duration`, 0..1. */
  progress: number;
  index: number;
  width: number;
  height: number;
  fps: number;
  bpm: number;
  /** Beats elapsed on the video timeline. */
  beat: number;
  voice: VoiceTrack;
}

export interface SceneModule {
  start?: number;
  duration?: number;
  /** Overlay scenes (captions, watermark) are drawn on top of every scene for the whole video. */
  overlay?: boolean;
  draw(ctx: CanvasRenderingContext2D, t: number, f: Frame): void;
}

/** What the server tells the player about a project (`__manifest`). */
export interface Manifest {
  video: VideoConfig;
  /** Scene module paths, in drawing order. */
  scenes: string[];
  /** Path of the Web Audio score, if the project has one. */
  audio: string | null;
  /** Paths of the voice clip JSON files. */
  voice: string[];
}

export interface SceneTiming {
  path: string;
  start: number;
  duration: number;
  overlay: boolean;
}

export interface SceneError {
  path: string;
  message: string;
  time?: number;
}
