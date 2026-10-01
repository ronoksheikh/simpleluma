// The whole journey, end to end, against a running Luma Studio (docker compose up) and the scripted mock model.
//   LUMA_URL=http://localhost:3000 MOCK_LLM_URL=http://host.docker.internal:4010/v1 node e2e/run.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE, LLM_URL, SHOTS, launch, step, summary } from './lib.mjs';

mkdirSync(SHOTS, { recursive: true });
const SECRET_VALUE = 'sup3r-s3cret-value-12345';
const { browser, context, page } = await launch();
const email = `user${Date.now()}@example.com`;

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const playerFrame = () => page.frames().find((f) => f.url().includes('/player'));
const expectText = async (locator, text, timeout = 30_000) => locator.filter({ hasText: text }).first().waitFor({ timeout });
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());

async function waitForPlayer(expectedClock) {
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].length > 0, null, { timeout: 15_000 });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const f = playerFrame();
    const text = f && (await f.evaluate(() => (document.body.dataset.ready ? document.querySelector('#time')?.textContent : null)).catch(() => null));
    if (text && (!expectedClock || text.endsWith(expectedClock))) return text;
    await page.waitForTimeout(300);
  }
  throw new Error(`Player did not show ${expectedClock ?? 'a ready state'}`);
}

async function chat(text) {
  await page.getByLabel('Message the Director').fill(text);
  await page.getByRole('button', { name: /^(Send|Queue message)$/ }).click();
}
const agentIdle = () => page.getByRole('button', { name: 'Stop the Director' }).waitFor({ state: 'detached', timeout: 120_000 });
const api = async (method, path, data) => (await page.request.fetch(`${BASE}${path}`, { method, data })).json();
/** Workspace tabs: the main ones are tabs, the rest live under More. */
async function openTab(name) {
  await page.getByRole('tablist', { name: 'Workspace' }).waitFor();
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
  if (await tab.count()) return tab.first().click();
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name }).click();
}
async function projectIdFromUrl() {
  return new URL(page.url()).pathname.split('/').pop();
}
async function newVideo(name, template) {
  await page.goto(BASE);
  if (template) await page.getByRole('button', { name: new RegExp(template) }).click();
  await page.getByRole('button', { name: /open an empty video/ }).click();
  await page.waitForURL('**/p/*');
  const title = page.getByLabel('Video name');
  await title.fill(name);
  await title.press('Enter');
  return projectIdFromUrl();
}
/** Click "Create link" in the open share dialog and return the new link (the newest one is listed first). */
async function createLink() {
  const links = page.getByLabel('Share link');
  const before = await links.count();
  await page.getByRole('button', { name: 'Create link' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('input[aria-label="Share link"]').length > n, before);
  return links.first().inputValue();
}
async function renderAndWait(button) {
  await page.getByRole('button', { name: button }).click();
  await page.getByRole('tab', { name: /^Renders/ }).waitFor();
  await page.locator('video').first().waitFor({ timeout: 240_000 });
}

try {
  // 1 + 2 ----------------------------------------------------------------------------------------
  await step('sign up and connect a model', async () => {
    await page.goto(BASE + '/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/setup');
    await page.getByRole('radio', { name: 'Custom' }).click();
    await page.getByLabel('Base URL').fill(LLM_URL);
    await page.getByLabel('API key').fill('test-key');
    await page.getByText('2 models available.').waitFor();
    await page.getByRole('combobox', { name: 'Model' }).fill('mock-tools');
    await page.getByRole('button', { name: 'Test & save' }).click();
    await page.waitForURL(BASE + '/');
  });

  // 3 + 5: chat with live tool cards and the live preview -----------------------------------------
  let introId;
  await step('create a video and ask for a 15-second logo intro: tool cards stream in', async () => {
    introId = await newVideo('Lumademy logo intro');
    await page.getByLabel('Message the Director').waitFor();
    await shot('10-studio-empty');
    await chat('Make a 15-second Lumademy logo intro');
    await expectText(page.locator('li'), 'Writing video.json', 20_000).catch(() => undefined);
    await expectText(page.locator('div'), 'Wrote scenes/01-intro.js');
    await expectText(page.locator('div'), 'Looked at 4.5s');
    await expectText(page.locator('div'), 'Saved: Add Lumademy logo intro');
    await expectText(page.locator('div'), 'Rendered quick preview', 120_000);
    await expectText(page.locator('p'), 'Your 15-second Lumademy logo intro is ready');
    await agentIdle();
    await shot('11-studio-intro');
  });

  await step('live preview reloaded with the new 15 s video and plays', async () => {
    const clock = await waitForPlayer('0:15.0');
    console.log('   preview clock:', clock);
    const f = playerFrame();
    await f.click('#big');
    await page.waitForTimeout(1800);
    const now = await f.evaluate(() => document.querySelector('#time').textContent);
    if (now.startsWith('0:00.0 /')) throw new Error('the preview did not advance while playing');
    await f.click('#play');
    await shot('12-preview-playing');
  });

  // 6: rendering with progress, final MP4 -----------------------------------------------------------
  await step('final 1080p render: progress, playback and download', async () => {
    await page.getByRole('button', { name: 'Render 1080p' }).click();
    await page.getByRole('progressbar').first().waitFor({ timeout: 30_000 });
    await shot('13-render-progress');
    await page.getByText('Render complete').waitFor({ timeout: 240_000 });
    await shot('14-render-complete');
    const href = await page.getByRole('link', { name: 'Download' }).first().getAttribute('href');
    const res = await page.request.get(BASE + href);
    const file = `${SHOTS}/final.mp4`;
    writeFileSync(file, await res.body());
    const info = probe(file);
    const video = info.streams.find((s) => s.codec_type === 'video');
    const audio = info.streams.find((s) => s.codec_type === 'audio');
    console.log(`   final.mp4: ${video.width}x${video.height} ${video.codec_name}, audio ${audio?.codec_name}, ${Number(info.format.duration).toFixed(2)}s`);
    if (video.height !== 1080) throw new Error('final render is not 1080p');
    if (!audio) throw new Error('final render has no audio');
    if (Math.abs(Number(info.format.duration) - 15) > 0.2) throw new Error('final render is not 15 seconds');
  });

  // 5: history, diff, restore -----------------------------------------------------------------------
  await step('history shows every change with its diff; restore brings back an older version', async () => {
    await openTab('History');
    const commit = (message) => page.getByRole('button', { name: new RegExp(`^${message}`) });
    await commit('Add Lumademy logo intro').waitFor();
    await commit('Add Lumademy logo intro').click();
    await page.getByText('scenes/01-intro.js').first().waitFor();
    await shot('15-history-diff');
    await commit('Create video').click();
    await page.getByRole('button', { name: 'Restore this version' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByText(/Restore version/).first().waitFor();
    const video = await (await page.request.get(`${BASE}/api/projects/${introId}/files/video.json`)).json();
    if (video.duration !== 5) throw new Error(`expected the restored video.json to be 5 s, got ${video.duration}`);
    await shot('16-history-restored');
  });

  // 4: attachments, zips and the Director writing brand.json -----------------------------------
  await step('attachments: SVG, PDF and a zipped kit; the Director reads them and writes brand.json', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2970EC"/><circle cx="50" cy="50" r="30" fill="#5DAEFF"/></svg>';
    const pdf = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 45>>stream\nBT /F1 18 Tf 20 100 Td (Brand brief: calm) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n';
    const upload = (files) => page.request.post(`${BASE}/api/projects/${introId}/attachments`, { multipart: Object.fromEntries(files.map((f, i) => [`f${i}`, f])) });
    const ok = await upload([{ name: 'brand.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }, { name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) }]);
    if (!ok.ok()) throw new Error(`upload failed: ${await ok.text()}`);
    const bad = await upload([{ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') }]);
    if (bad.status() !== 400) throw new Error('an .exe attachment should be rejected');
    // A zipped brand kit unpacks into assets/<kit>/, keeping its folders.
    const kit = `${SHOTS}/kit`;
    mkdirSync(`${kit}/Logos`, { recursive: true });
    writeFileSync(`${kit}/Logos/mark.svg`, svg);
    writeFileSync(`${kit}/Guidelines.md`, '# Acme\n| Name | Hex |\n|---|---|\n| Acme Blue | `#2970EC` |\n');
    execFileSync('zip', ['-qr', `${SHOTS}/kit.zip`, '.'], { cwd: kit });
    const zipped = await upload([{ name: 'kit.zip', mimeType: 'application/zip', buffer: readFileSync(`${SHOTS}/kit.zip`) }]);
    const added = (await zipped.json()).added?.map((a) => a.path) ?? [];
    if (!added.includes('assets/kit/Logos/mark.svg') || !added.includes('assets/kit/Guidelines.md')) throw new Error(`the zip did not unpack as expected: ${added.join(', ')}`);
    await page.goto(`${BASE}/p/${introId}`);
    await openTab('Assets');
    await page.getByText('brand.svg').first().waitFor();
    await page.getByText('assets/kit/Logos').first().waitFor();
    await shot('23-assets-tab');
    await chat('Read my brand files');
    await expectText(page.locator('div'), 'Read assets/brief.pdf', 60_000);
    await expectText(page.locator('div'), 'Updated brand.json', 60_000);
    await agentIdle();
    const messages = (await api('GET', `/api/projects/${introId}/chat`)).messages;
    const svgResult = messages.find((m) => m.role === 'tool' && m.content.includes('assets/brand.svg'))?.content ?? '';
    const pdfResult = messages.find((m) => m.role === 'tool' && m.content.includes('Brand brief'))?.content ?? '';
    if (!/#2970ec/i.test(svgResult) || !/#5daeff/i.test(svgResult)) throw new Error(`the SVG colours were not reported: ${svgResult.slice(0, 200)}`);
    if (!pdfResult) throw new Error('the PDF text was not extracted');
    const { brand } = await api('GET', `/api/projects/${introId}/brand`);
    if (brand.name !== 'Lumademy' || !brand.colors.some((c) => c.role === 'avoid' && c.hex === '#10234B')) throw new Error(`brand.json was not written by the Director: ${JSON.stringify(brand).slice(0, 200)}`);
    await openTab('Brand');
    await page.locator('input[value="Lumademy Blue"]').waitFor();
    await shot('24-brand-tab');
    for (const path of ['assets/brand.svg', 'assets/brief.pdf', ...added]) await page.request.delete(`${BASE}/api/projects/${introId}/attachments?path=${encodeURIComponent(path)}`);
  });

  // Director: thinking, plan, auto-check and fix, memory, checkpoints, Markdown -----------------------
  let fanId;
  await step('the Director plans, streams its thinking, and fixes a broken scene the auto-check catches', async () => {
    fanId = await newVideo('Fan unfold');
    await chat('Make a fan unfold logo intro');
    await page.getByText('Thinking…').first().waitFor({ timeout: 30_000 });
    await shot('25-thinking-live');
    await page.getByText(/Auto-check caught an error/).waitFor({ timeout: 60_000 });
    await expectText(page.locator('div'), 'Checked the video', 60_000);
    await agentIdle();
    await page.locator('.md table').first().waitFor();
    await page.getByText('Plan complete').first().waitFor();
    await page.getByText(/Thought for \d+ words/).first().waitFor();
    const memories = await api('GET', `/api/memories?project=${fanId}`);
    if (!memories.some((m) => m.projectId === null && m.source === 'director')) throw new Error('the Director did not save a global memory');
    const checkpoints = await api('GET', `/api/projects/${fanId}/checkpoints`);
    if (!checkpoints.some((c) => !c.auto && c.sha)) throw new Error('no checkpoint was saved with a version');
    const chatState = await api('GET', `/api/projects/${fanId}/chat`);
    if (chatState.todos.length !== 4 || chatState.todos.some((t) => t.status !== 'done')) throw new Error('the plan is not complete');
    if (!(chatState.usage.prompt > 0)) throw new Error('token usage was not recorded');
    await page.getByRole('button', { name: 'Plan' }).first().click();
    await page.getByText('4 of 4 done').waitFor();
    await shot('26-plan-popover');
    await page.keyboard.press('Escape');
  });

  await step('long jobs: a message sent mid-run is queued; the step limit pauses with a Continue button', async () => {
    await api('PUT', '/api/director', { preferences: { stepLimit: 5 } });
    try {
      await chat('Run forever please');
      await page.getByText('Starting a very long job.').first().waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Continue' }).waitFor({ timeout: 60_000 });
      await page.getByText('Paused after 5 steps').waitFor();
      await shot('27-step-limit');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'Stop the Director' }).waitFor({ timeout: 15_000 });
      await chat('Also make it blue');
      await page.getByText(/Queued ·/).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await agentIdle();
      const state = await api('GET', `/api/projects/${fanId}/chat`);
      const users = state.messages.filter((m) => m.role === 'user');
      if (!users.some((m) => m.hidden && m.content.startsWith('Continue where you stopped'))) throw new Error('Continue did not resume the job');
      if (!users.some((m) => m.content === 'Also make it blue')) throw new Error('the queued message never reached the Director');
    } finally {
      await api('PUT', '/api/director', { preferences: { stepLimit: 60 } });
    }
  });

  // 9: terminal + secrets ---------------------------------------------------------------------------
  await step('settings: save a secret', async () => {
    await page.goto(BASE + '/settings?tab=secrets');
    await page.getByLabel('Name', { exact: true }).fill('MY_TOKEN');
    await page.getByLabel('Value').fill(SECRET_VALUE);
    await page.getByRole('button', { name: 'Save secret' }).click();
    await page.getByText('MY_TOKEN').first().waitFor();
    await shot('20-settings-secrets');
  });

  await step('terminal: user shell works in the project folder and hides secrets', async () => {
    await page.goto(`${BASE}/p/${introId}`);
    await openTab('Terminal');
    await page.getByRole('tab', { name: 'Your shell' }).click();
    await page.locator('[aria-label="Your shell terminal"] .xterm').waitFor();
    await page.waitForTimeout(800);
    await page.locator('[aria-label="Your shell terminal"] .xterm-helper-textarea').focus();
    await page.keyboard.type('ls && echo "token=$MY_TOKEN"\n');
    await page.waitForFunction(() => document.body.innerText.includes('token=[secret:MY_TOKEN]'), null, { timeout: 15_000 });
    const text = await page.locator('[aria-label="Your shell terminal"] .xterm-rows').innerText();
    if (text.includes(SECRET_VALUE)) throw new Error('the secret value leaked into the terminal');
    if (!text.includes('video.json')) throw new Error('ls did not list the project files');
    await shot('21-terminal');
  });

  await step("the Director's commands show live in the Terminal tab, secret redacted", async () => {
    await chat('Run the command that uses my secret');
    await page.getByRole('tab', { name: 'Director', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some((el) => el.textContent.includes('token is [secret:MY_TOKEN]')), null, { timeout: 60_000 });
    await agentIdle();
    const all = JSON.stringify(await (await page.request.get(`${BASE}/api/projects/${introId}/chat`)).json());
    if (all.includes(SECRET_VALUE)) throw new Error('the secret value is in the stored conversation');
    await shot('22-agent-terminal');
  });

  await step('agent commands stop at their timeout and can be stopped by the user', async () => {
    await chat('Run something that will hang');
    await page.getByRole('tab', { name: 'Director', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some((el) => el.textContent.includes('stopped after 2s')), null, { timeout: 30_000 });
    await agentIdle();
    await chat('Do a long job slowly');
    await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some((el) => el.textContent.includes('working')), null, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await agentIdle();
    await expectText(page.locator('div'), 'Ran echo working', 10_000);
    const last = (await (await page.request.get(`${BASE}/api/projects/${introId}/chat`)).json()).messages.at(-1);
    if (last.role === 'assistant' && last.content.includes('Finished the long job')) throw new Error('the run continued after Stop');
    await shot('23-stopped');
  });

  // 8: ElevenLabs ------------------------------------------------------------------------------------
  await step('settings: ElevenLabs Test shows voices and quota; Save only after a passing test', async () => {
    await page.goto(BASE + '/settings?tab=voice');
    const key = page.getByLabel('API key').last();
    await key.fill('bad-key');
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await page.getByText('ElevenLabs rejected this API key').waitFor();
    if (!(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled())) throw new Error('Save was enabled without a passing test');
    await key.fill('el-test-key');
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await page.getByText(/Key works · 2 voices/).waitFor();
    await page.getByText(/8,800 of 10,000 characters left/).waitFor();
    await shot('30-elevenlabs-test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/A key ending/).waitFor();
  });

  await step('voice-over: generated with timestamps, captions follow the words', async () => {
    await page.goto(`${BASE}/p/${introId}`);
    await chat('Add a voice-over with captions');
    await expectText(page.locator('div'), 'Recorded “intro”', 90_000);
    await expectText(page.locator('div'), 'Saved: Add voice-over and captions', 60_000);
    await agentIdle();
    const clip = await (await page.request.get(`${BASE}/api/projects/${introId}/files/audio/voice/intro.json`)).json();
    const first = clip.words[0];
    console.log(`   voice: "${clip.text}" at ${clip.at}s, ${clip.words.length} words, "${first.text}" ${first.start.toFixed(2)}–${first.end.toFixed(2)}s`);
    if (clip.words.length !== 6) throw new Error(`expected 6 timed words, got ${clip.words.length}`);
    await openTab('Audio');
    await page.locator('audio').first().waitFor();
    await shot('31-audio-tab');
    // The captured frame at 2.0 s shows the caption for "Lumademy." lit up.
    await openTab('Preview');
    await waitForPlayer();
    const f = playerFrame();
    await f.evaluate(() => { document.querySelector('#scrub').value = 2000; document.querySelector('#scrub').dispatchEvent(new Event('input')); });
    await page.waitForTimeout(500);
    await shot('32-captions-frame');
  });

  // 7: share links ------------------------------------------------------------------------------------
  let shareUrl;
  await step('share a preview version: a logged-out visitor can play it', async () => {
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    shareUrl = await createLink();
    await shot('40-share-dialog');
    const visitor = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const vp = await visitor.newPage();
    await vp.goto(shareUrl);
    await vp.waitForFunction(() => [...document.querySelectorAll('iframe')].length > 0);
    const deadline = Date.now() + 20_000;
    let clock = null;
    while (Date.now() < deadline && !clock) {
      const f = vp.frames().find((x) => x.url().includes('/player'));
      clock = f && (await f.evaluate(() => (document.body.dataset.ready ? document.querySelector('#time').textContent : null)).catch(() => null));
      if (!clock) await vp.waitForTimeout(300);
    }
    if (!clock) throw new Error('the public player did not load');
    console.log('   visitor sees:', clock);
    await vp.screenshot({ path: `${SHOTS}/41-public-player.png` });
    await visitor.close();
  });

  await step('revoking the link turns it off for visitors', async () => {
    await page.getByRole('button', { name: 'Turn off' }).first().click();
    await page.getByText('Turned off').first().waitFor();
    const visitor = await browser.newContext();
    const vp = await visitor.newPage();
    await vp.goto(shareUrl);
    await vp.getByText('This link is not available').waitFor();
    await vp.screenshot({ path: `${SHOTS}/42-link-off.png` });
    await visitor.close();
    await page.getByRole('button', { name: /close/i }).first().click();
  });

  await step('share a render: visitor gets the MP4 without logging in; expiry is enforced', async () => {
    await openTab('Renders');
    await page.locator('li').getByRole('button', { name: 'Share', exact: true }).first().click();
    const url = await createLink();
    const token = url.split('/s/')[1];
    const visitor = await browser.newContext();
    const vp = await visitor.newPage();
    await vp.goto(url);
    await vp.locator('video').waitFor().catch(async () => {
      throw new Error(`the shared render page shows: ${(await vp.locator('body').innerText()).slice(0, 120)} (${url})`);
    });
    // The bundled test Chromium cannot decode H.264, so check the file the link serves instead of playback.
    const head = await fetch(`${BASE}/api/share/${token}/video`, { headers: { range: 'bytes=0-1' } });
    if (head.status !== 206 || head.headers.get('content-type') !== 'video/mp4') throw new Error(`the shared video is not served with ranges (${head.status})`);
    const info = await fetch(`${BASE}/api/share/${token}`).then((r) => r.json());
    console.log(`   visitor sees: ${info.label}`);
    await vp.screenshot({ path: `${SHOTS}/43-public-video.png` });
    await visitor.close();
    const short = await page.request.post(`${BASE}/api/projects/${introId}/shares`, { data: { kind: 'version', expiresInHours: 0.0003 } });
    const shortToken = (await short.json()).token;
    await page.waitForTimeout(1600);
    const expired = await fetch(`${BASE}/api/share/${shortToken}`);
    if (expired.status !== 410) throw new Error(`an expired link should answer 410, got ${expired.status}`);
    const ok = await fetch(`${BASE}/api/share/${token}`);
    if (ok.status !== 200) throw new Error('share info should be public');
    await page.getByRole('button', { name: /close/i }).first().click();
  });

  // 6 (cache) ----------------------------------------------------------------------------------------
  await step('editing one scene of a long video re-renders only that scene', async () => {
    const demoId = await newVideo('Demo reel', 'Demo reel');
    await page.getByRole('button', { name: 'Quick 480p' }).click();
    await page.getByRole('tab', { name: /^Renders/ }).waitFor();
    await page.getByText(/scenes rendered/).first().waitFor({ timeout: 180_000 });
    const first = await page.getByText(/scenes rendered/).first().innerText();
    console.log('   first render:', first);
    await openTab('Terminal');
    await page.getByRole('tab', { name: 'Your shell' }).click();
    await page.waitForTimeout(800);
    await page.locator('[aria-label="Your shell terminal"] .xterm-helper-textarea').focus();
    await page.keyboard.type("sed -i 's/one frame at a time/one frame at a time!/' scenes/03-chart.js && echo edited\n");
    await page.waitForFunction(() => document.body.innerText.includes('edited'), null, { timeout: 15_000 });
    await openTab('Preview');
    await page.getByRole('button', { name: 'Quick 480p' }).click();
    await page.waitForFunction(() => document.querySelectorAll('video').length >= 2, null, { timeout: 180_000 });
    const second = await page.getByText(/scenes rendered/).first().innerText();
    console.log('   after editing scene 3:', second);
    const m = /(\d+) of (\d+) scenes rendered, (\d+) reused/.exec(second);
    if (!m || Number(m[1]) >= Number(m[2]) || Number(m[3]) === 0) throw new Error(`expected a partial re-render, got "${second}"`);
    await shot('50-cache-render');
    void demoId;
  });

  await step('rename a video and delete it from the dashboard', async () => {
    await page.goto(`${BASE}/p/${introId}`);
    const title = page.getByLabel('Video name');
    await title.fill('Renamed intro');
    await title.press('Enter');
    await page.goto(BASE);
    const card = page.locator('main').getByRole('link', { name: /Renamed intro/ });
    await card.waitFor();
    await card.hover();
    await page.getByRole('button', { name: 'More actions for Renamed intro' }).click();
    await page.getByRole('menuitem', { name: /Delete video/ }).click();
    await page.getByRole('button', { name: 'Delete video' }).click();
    await card.waitFor({ state: 'detached' });
    await shot('60-dashboard-after-delete');
  });

  await step('log out and back in (wrong password is refused)', async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: new RegExp(email.replace(/[.]/g, '\\.')) }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await page.waitForURL('**/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Wrong email or password.').waitFor();
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(BASE + '/');
  });

  summary();
} catch (e) {
  await shot('99-failure').catch(() => undefined);
  throw e;
} finally {
  await browser.close();
}
