import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface ChunkEncoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

interface EncodeOptions {
  fps: number;
  /** Format of the piped frames. */
  input: 'png' | 'mjpeg';
  preset: string;
  crf: number;
}

function waitForExit(child: ChildProcess, stderr: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`ffmpeg could not start: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr().slice(-600)}`))));
  });
}

/** Encode piped frames to a video-only H.264 file. */
export function encodeChunk(output: string, o: EncodeOptions): ChunkEncoder {
  const child = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', o.input, '-i', '-',
      '-an', '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-pix_fmt', 'yuv420p',
      '-r', String(o.fps), '-g', String(Math.round(o.fps * 2)), '-bf', '0',
      output,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = waitForExit(child, () => stderr);
  exited.catch(() => undefined);
  return {
    async write(frame) {
      if (!child.stdin.write(frame)) await Promise.race([once(child.stdin, 'drain'), exited]);
    },
    async finish() {
      child.stdin.end();
      await exited;
    },
    abort: () => child.kill('SIGKILL'),
  };
}

/** Join cached chunks (and the soundtrack, if any) into the final MP4. */
export async function assemble(chunks: string[], audioWav: string | null, output: string, listFile: string): Promise<void> {
  await writeFile(listFile, chunks.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (audioWav) args.push('-i', audioWav, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-c:v', 'copy', '-movflags', '+faststart', output);
  try {
    await exec('ffmpeg', args);
  } catch (e) {
    throw new Error(`ffmpeg could not assemble the video: ${(e as { stderr?: string }).stderr?.slice(-600) ?? e}`);
  }
}

/** Duration and video stream frame count of a media file. */
export async function probe(file: string): Promise<{ duration: number }> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return { duration: Number(stdout.trim()) };
}
