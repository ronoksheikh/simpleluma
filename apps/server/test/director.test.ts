import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compact } from '../src/agent/context.js';
import { isPrivate } from '../src/agent/fetch.js';
import { userText } from '../src/agent/messages.js';
import { detectFromSvg, detectFromText } from '../src/brand/detect.js';
import { ThinkSplitter, estimateTokens, type ChatMessage } from '../src/lib/llm.js';

test('splits <think> blocks out of streamed text, across chunk boundaries', () => {
  const t = new ThinkSplitter();
  const parts = ['Hi <thi', 'nk>plan the ', 'scene</th', 'ink>Done.'].map((c) => t.push(c));
  const end = t.flush();
  assert.equal(parts.map((p) => p.text).join('') + end.text, 'Hi Done.');
  assert.equal(parts.map((p) => p.reasoning).join('') + end.reasoning, 'plan the scene');
});

test('keeps a lone "<" that is not a think tag', () => {
  const t = new ThinkSplitter();
  const out = t.push('a < b') .text + t.flush().text;
  assert.equal(out, 'a < b');
});

test('estimates tokens at about four characters each', () => {
  assert.equal(estimateTokens([{ role: 'user', content: 'x'.repeat(400) }]), 100);
});

test('reads named colours, gradients, fonts and rules from brand guidelines', () => {
  const brand = detectFromText(`# Lumademy — Brand Guidelines
## Colors
| Token | HEX | Usage |
|---|---|---|
| Lumademy Blue | \`#2970EC\` | Primary brand blue |
| Sky Blue | \`#5DAEFF\` | Light end of brand gradient |
| Off White | \`#EFF5FF\` | Background |
Primary background gradient: \`linear-gradient(135deg, #5DAEFF 0%, #2970EC 100%)\`
## Typography
Use **Inter Display Medium** for the brand name.
## Usage
- Do not stretch, rotate, or recolor with orange.
`);
  assert.equal(brand.name, 'Lumademy');
  assert.deepEqual(brand.colors.map((c) => [c.name, c.hex, c.role]), [
    ['Lumademy Blue', '#2970EC', 'primary'],
    ['Sky Blue', '#5DAEFF', 'gradient'],
    ['Off White', '#EFF5FF', 'background'],
  ]);
  assert.equal(brand.gradients.length, 1);
  assert.equal(brand.fonts[0]?.family, 'Inter Display Medium');
  assert.ok(brand.rules.some((r) => r.startsWith('Do not stretch')));
});

test('reads SVG colours and gradients, skipping neutrals', () => {
  const found = detectFromSvg('assets/logo.svg', `<svg><title>Acme</title><linearGradient id="g"><stop offset="0" stop-color="#70BFFF"/><stop offset="1" stop-color="#1552C5"/></linearGradient><path fill="#FFFFFF"/><path fill="#2970ec"/></svg>`);
  assert.equal(found.name, 'Acme');
  assert.deepEqual(found.colors.map((c) => c.hex).sort(), ['#1552C5', '#2970EC', '#70BFFF']);
  assert.deepEqual(found.gradients, ['linear-gradient(135deg, #70BFFF 0%, #1552C5 100%)']);
  assert.equal(found.logos[0]?.path, 'assets/logo.svg');
});

test('blocks private and local addresses for fetch_url', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivate(ip), true, ip);
  for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) assert.equal(isPrivate(ip), false, ip);
});

test('tells the model about attachments and the scene the user pointed at', () => {
  const text = userText({ content: 'Slower please', meta: { attachments: ['assets/logo.svg'], context: [{ type: 'scene', path: 'scenes/02-unfold.js', start: 1.2, duration: 1.4 }] } });
  assert.match(text, /assets\/logo\.svg/);
  assert.match(text, /Focus: scenes\/02-unfold\.js.*1\.20s–2\.60s/);
});

test('trims old context without orphaning tool results', () => {
  const big = 'x'.repeat(5000);
  const messages: ChatMessage[] = [{ role: 'system', content: 'sys' }];
  for (let i = 0; i < 40; i++) {
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
    messages.push({ role: 'tool', tool_call_id: `c${i}`, content: big });
    messages.push({ role: 'user', content: `note ${i} ${big}` });
  }
  compact(messages, 30_000);
  assert.equal(messages[0]!.role, 'system');
  assert.match(String(messages[1]!.content), /Earlier messages were removed/);
  assert.notEqual(messages[2]!.role, 'tool');
  for (let i = 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'tool') assert.ok(messages.slice(0, i).some((p) => p.role === 'assistant' && p.tool_calls?.some((c) => c.id === m.tool_call_id)));
  }
  const size = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  assert.ok(size < 60_000);
});
