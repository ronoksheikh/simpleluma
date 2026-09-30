// A scripted OpenAI-compatible server for end-to-end tests: it "designs" a logo intro with real tool calls.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4010);

const introScene = `import { clamp, ease, linearGradient, map, roundRect, text } from 'luma';

export const start = 0;
export const duration = 15;

const colors = { blue: '#2970EC', sky: '#5DAEFF', royal: '#1557D1', deep: '#07358F' };

export function draw(ctx, t, f) {
  const { width: w, height: h } = f;
  const out = map(t, duration - 1, duration, 1, 0);
  const pop = ease.outBack(clamp((t - 0.6) / 1.2));
  const size = 260 * pop;
  ctx.globalAlpha = clamp(t / 0.5) * out;
  roundRect(ctx, w / 2 - size / 2, h / 2 - 120 - size / 2, size, size, size * 0.28);
  ctx.fillStyle = linearGradient(ctx, w / 2 - size / 2, h / 2 - 250, w / 2 + size / 2, h / 2 + 10, [[0, colors.sky], [0.37, colors.blue], [0.72, colors.royal], [1, colors.deep]]);
  ctx.fill();
  const rise = ease.outCubic(clamp((t - 2) / 1));
  ctx.globalAlpha = rise * out;
  text(ctx, 'Lumademy', w / 2, h / 2 + 140 + (1 - rise) * 30, { size: 120, weight: 500, align: 'center', baseline: 'middle', tracking: -2 });
  const tag = ease.outCubic(clamp((t - 3.5) / 1));
  ctx.globalAlpha = tag * out;
  text(ctx, 'Learn by making', w / 2, h / 2 + 250, { size: 44, weight: 400, align: 'center', baseline: 'middle', color: colors.sky, tracking: 2 });
}
`;

const introAudio = `import { sound } from 'luma';
export function schedule(ac, startTime, out) {
  sound.tone(ac, out, { time: startTime + 0.6, freq: 220, duration: 3, type: 'sine', gain: 0.12, attack: 0.3, release: 1.2 });
  sound.tone(ac, out, { time: startTime + 0.6, freq: 330, duration: 3, type: 'sine', gain: 0.08, attack: 0.3, release: 1.2 });
  sound.kick(ac, out, { time: startTime + 0.6, gain: 0.4 });
}
`;

const captionScene = `import { captions } from 'luma';
export const overlay = true;
export function draw(ctx, t, f) {
  captions(ctx, f, { x: f.width / 2, y: f.height - 140, maxWidth: 1400, size: 56 });
}
`;

const scenarios = {
  intro: [
    { text: "I'll build a 15-second Lumademy logo intro: a gradient tile pops in, the wordmark rises, then a tagline.", calls: [{ name: 'write_file', args: { path: 'video.json', content: JSON.stringify({ width: 1920, height: 1080, fps: 30, duration: 15, bpm: 96, background: '#071738' }, null, 2) + '\n' } }] },
    { calls: [{ name: 'write_file', args: { path: 'scenes/01-intro.js', content: introScene } }, { name: 'write_file', args: { path: 'audio.js', content: introAudio } }] },
    { calls: [{ name: 'capture_frame', args: { time: 4.5 } }] },
    { calls: [{ name: 'commit', args: { message: 'Add Lumademy logo intro' } }] },
    { calls: [{ name: 'render_preview', args: {} }] },
    { text: 'Your 15-second Lumademy logo intro is ready and rendered. Ask me to change timing, colours or add a voice-over.' },
  ],
  command: [
    { text: 'Running a script that uses a saved secret.', calls: [{ name: 'run_command', args: { command: 'echo "token is $MY_TOKEN"; echo done' } }] },
    { text: 'The command ran; the secret stayed hidden.' },
  ],
  voice: [
    { calls: [{ name: 'list_voices', args: {} }] },
    { calls: [{ name: 'generate_voice', args: { text: 'Welcome to Lumademy. Learn by making.', voice_id: 'voice_rachel', name: 'intro', at: 1 } }] },
    { calls: [{ name: 'write_file', args: { path: 'scenes/02-captions.js', content: captionScene } }] },
    { calls: [{ name: 'capture_frame', args: { time: 2.0 } }] },
    { calls: [{ name: 'commit', args: { message: 'Add voice-over and captions' } }] },
    { text: 'Added a voice-over with word-by-word captions.' },
  ],
  hang: [
    { text: 'Running something that never ends.', calls: [{ name: 'run_command', args: { command: 'echo started; sleep 30', timeout_seconds: 2 } }] },
    { text: 'That command was stopped by its timeout.' },
  ],
  slow: [
    { text: 'Starting a long job.', calls: [{ name: 'run_command', args: { command: 'echo working; sleep 120' } }] },
    { text: 'Finished the long job.' },
  ],
  brand: [
    { text: 'Reading your brand files first.', calls: [{ name: 'read_file', args: { path: 'assets/brand.svg' } }, { name: 'read_file', args: { path: 'assets/brief.pdf' } }] },
    { text: 'I will use the brand colours from the SVG and the brief.' },
  ],
  share: [
    { calls: [{ name: 'share_preview', args: {} }] },
    { text: 'Here is your share link.' },
  ],
  edit: [
    { calls: [{ name: 'edit_file', args: { path: 'scenes/01-intro.js', old_string: "'Learn by making'", new_string: "'Learn by making things'" } }] },
    { calls: [{ name: 'render_preview', args: {} }] },
    { text: 'Updated the tagline and re-rendered.' },
  ],
};

function pick(messages) {
  const lastUser = [...messages].reverse().findIndex((m) => m.role === 'user' && typeof m.content === 'string');
  const idx = messages.length - 1 - lastUser;
  const prompt = String(messages[idx]?.content ?? '').toLowerCase();
  const tail = messages.slice(idx + 1);
  const name = prompt.includes('hang') ? 'hang' : prompt.includes('slowly') ? 'slow' : prompt.includes('brand files') ? 'brand' : prompt.includes('logo intro') ? 'intro' : prompt.includes('secret') ? 'command' : prompt.includes('voice') ? 'voice' : prompt.includes('share') ? 'share' : prompt.includes('tagline') ? 'edit' : null;
  return { name, step: tail.filter((m) => m.role === 'assistant').length };
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: c }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer test-key') {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
  }
  if (url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'mock-tools', name: 'Mock (tools)', supported_parameters: ['tools'] }, { id: 'mock-plain', name: 'Mock (no tools)', supported_parameters: [] }] }));
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    if (json.model === 'mock-plain') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }));
    }
    if (json.tools?.some((t) => t.function.name === 'ping')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ping', arguments: '{"word":"pong"}' } }] } }] }));
    }
    const { name, step } = pick(json.messages);
    const script = name ? scenarios[name] : null;
    const current = script?.[step];
    if (!current) return sse(res, [{ role: 'assistant', content: script ? 'All done.' : 'Tell me what video to make, for example "a 15-second logo intro".' }]);
    const chunks = [];
    if (current.text) for (let i = 0; i < current.text.length; i += 12) chunks.push({ role: 'assistant', content: current.text.slice(i, i + 12) });
    (current.calls ?? []).forEach((call, index) => {
      const args = JSON.stringify(call.args);
      chunks.push({ tool_calls: [{ index, id: `call_${step}_${index}`, type: 'function', function: { name: call.name, arguments: '' } }] });
      for (let i = 0; i < args.length; i += 400) chunks.push({ tool_calls: [{ index, function: { arguments: args.slice(i, i + 400) } }] });
    });
    setTimeout(() => sse(res, chunks), 300);
  });
});

server.listen(PORT, () => console.log(`mock llm on ${PORT}`));
