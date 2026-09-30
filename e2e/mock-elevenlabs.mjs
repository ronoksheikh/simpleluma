// A tiny ElevenLabs stand-in: voices, quota, and text-to-speech with per-character timestamps.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_ELEVENLABS_PORT ?? 4020);

/** A real MP3 of `seconds` of quiet tone, made with ffmpeg. */
function tone(seconds) {
  const out = join(mkdtempSync(join(tmpdir(), 'mock11-')), 'voice.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-filter:a', 'volume=0.2', out]);
  return readFileSync(out);
}

createServer((req, res) => {
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers['xi-api-key'] !== 'el-test-key') return json(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/v1/voices') return json(200, { voices: [{ voice_id: 'voice_rachel', name: 'Rachel', category: 'premade', description: 'Calm, clear narrator', preview_url: null }, { voice_id: 'voice_adam', name: 'Adam', category: 'premade', description: 'Deep and warm' }] });
  if (url.pathname === '/v1/user/subscription') return json(200, { character_count: 1200, character_limit: 10000, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 20 });
  if (url.pathname.startsWith('/v1/text-to-speech/') && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { text } = JSON.parse(body);
      const characters = [...text];
      const per = 0.07;
      const duration = characters.length * per;
      return json(200, {
        audio_base64: tone(duration + 0.2).toString('base64'),
        alignment: {
          characters,
          character_start_times_seconds: characters.map((_, i) => i * per),
          character_end_times_seconds: characters.map((_, i) => (i + 1) * per),
        },
      });
    });
    return;
  }
  json(404, { detail: 'not found' });
}).listen(PORT, () => console.log(`mock elevenlabs on ${PORT}`));
