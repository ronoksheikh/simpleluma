# Luma Studio

Brief **the Director**, an AI motion designer that **makes motion-graphics videos in code** (Canvas 2D, Three.js, GSAP), shows a **live preview**, checks its own work and **renders MP4s**.
Every video is its own git project. Self-hosted, one container.

```bash
docker compose up --build
```

Open <http://localhost:3000>, create an account, connect a model, and write a brief on the home page, for example "a 15-second Lumademy logo intro".
Everything lives in `./data`: the SQLite database and one git repository per video (`data/projects/<id>`).

The first build downloads a large base image (Chromium, fonts) and takes a few minutes. After that it starts in seconds.

## What you need

- Docker with Compose.
- An API key for an OpenAI-compatible model **with tool calling** (OpenRouter and OpenAI are presets; any compatible base URL works, including a local server).
- Optional: an [ElevenLabs](https://elevenlabs.io) key for voice-overs.

Optional environment variables (see `docker-compose.yml`): `LUMA_SECRET_KEY` encrypts stored keys with a secret of your choosing instead of a generated key file (`data/.secret-key`).

## Using it

1. **Sign up**, then connect a model. Paste a key and the model list loads by itself. *Test & save* asks the model to call a function, so a model without tool calling is rejected. Reasoning models stream their thinking into the chat.
2. **Home**: write a brief, pick a template (Blank, 3D · Three.js, Kinetic type · GSAP, Demo reel) and a format (16:9, 1:1, 9:16). The video is created and the Director starts at once.
3. **Studio**, in three panels: your videos on the left, the chat in the middle, the workspace on the right (drag the divider to resize).
   - **Chat**: Markdown replies, collapsible thinking, each tool step as a compact row (diffs, frames, command output). The header shows the **plan** (click for the checklist), what the Director is doing (step *x* of the limit) and **tokens** (click for input/output, all runs and how much context is in use).
   - **Attachments** go on the message as chips: images, SVGs, PDFs, Markdown/text, fonts, audio, **zips** (unpacked into `assets/<name>/`) and **HTML motion references** (`references/`). Drop them anywhere on the chat or paste images.
   - **Point at the video**: under the preview, a scene timeline (click to seek) has a **+ Include this scene for changes** button, and **Include frame** points at the current moment (the Director gets a still of it).
   - Send while the Director works and the message is **queued** for its next step.
4. **Workspace tabs**: *Preview*, *Plan* (checklist + checkpoints you can restore), *Brand*, *Assets* (folders, references with a player and "Use as reference"), *Renders*, *Terminal* (the Director's commands live, and your own shell), and under *More*: *History*, *Memory*, *Audio*, *Code*.
5. **Render** a *Quick 480p* or *1080p* with a live progress bar. Finished videos play in the page and can be downloaded.
6. **Share** any live preview version or render with a link: random token, optional expiry, can be turned off. The link opens a clean full-screen player and needs no login.
7. **Settings**: *Director* (its system prompt, step limit, checkpoints, auto-check, brand auto-detect, thinking, global memory), *Models*, *Voice* (ElevenLabs), *Secrets*, *Usage* (tokens per video) and *Account*.

### The Director

- **Its own system prompt**, editable in Settings → Director (with a reset to the default). The framework guide, tools, brand, memory and plan are always appended, so editing it cannot break video building.
- **Plan**: for bigger jobs it writes a checklist (`update_plan`) and keeps exactly one step in progress.
- **Memory**: notes about this video and about you for every video, read in every conversation. It saves its own (`remember`/`forget`); you can add, edit and remove them.
- **Long jobs**: a step limit per run (default 60). At the limit it pauses and the chat shows a **Continue** button. **Checkpoints** (by the Director, and automatically every 15 steps) commit the work and record where it stands; when the conversation grows, old steps are trimmed and the plan, latest checkpoint and memory carry the job. Runs live on the server: **closing the browser does not stop them**, and a run interrupted by a server restart resumes once on its own.
- **Catches its own failures**: every JS file is syntax-checked as it is written, and after each step that changes code the video is loaded and sample frames drawn (`check_video`). Errors go straight back to the Director, which fixes them; the chat shows an *Auto-check caught an error* card. Preview errors have an *Ask the Director to fix* button.
- **Brand**: the Director reads your logos, guidelines and kits and records the brand in `brand.json` with judgement (`update_brand`). It must follow it: colours by role, colours to **never use**, gradients, fonts, which logo file to use where, rules and tone. Edit it all in the **Brand** tab. Rule-based detection is available as *Auto-detect* (Brand tab) or automatically on upload (Settings).
- **HTML motion references**: upload an `.html` demo and the Director watches it at chosen moments (`view_reference`, a contact sheet on a controlled clock) and reads its source to match its pacing and easing.
- **More tools**: `search_files` across the project, and `fetch_url` to read a public web page or download a font/image/library into `assets/` (private network addresses are refused).

### Voice-over

With an ElevenLabs key saved, the Director can list your voices and generate each line **with word timestamps** (`audio/voice/<name>.mp3` + `.json`).
It times scenes to the words, and `captions()` lights up each word as it is spoken. Music ducks automatically under the voice. The **Audio** tab lists the voice files with players.

### Custom APIs

Save a named secret (for example `IMAGE_API_KEY`) in Settings. It is an environment variable in every terminal, so the Director can write and run a small script that calls another API and saves the result into `assets/`.
The Director only ever sees secret **names**. Any secret value that appears in command output is replaced with `[secret:NAME]`.

## How it works

```
apps/web/          React + Vite + HeroUI v3 + Tailwind v4 + Phosphor icons + xterm.js
apps/server/       Fastify, SQLite (Drizzle), WebSocket, agent, renderer, git, terminal
packages/motion/   the video framework (player, helpers, project templates)
brand/  reference/  data/
```

### A video is a git project

```
video.json          { width, height, fps, duration, bpm, background }
scenes/*.js         each exports { start, duration, draw(ctx, t) }
audio.js            Web Audio score: schedule(audioCtx, startTime, out)
audio/voice/        generated voice lines + word timings (JSON)
assets/             the user's attachments (zips unpack into folders)
references/         HTML motion references
brand.json          the brand the Director follows (Brand tab)
```

Every frame depends only on the time `t`. Inside `draw`, `Date.now()` and `performance.now()` return the video time and `Math.random()` replays the same sequence on every frame, so frames never flicker and the render matches the preview. The framework provides `rng(seed)`, easing helpers, text/shape helpers and `captions()` (`import { ease, rng, text } from 'luma'`).

**Three.js and GSAP** are built in: `import * as THREE from 'three'` (addons from `three/addons/…`), `import gsap from 'gsap'` (plugins from `gsap/…`). Build a paused GSAP timeline at module level and `tl.seek(t)` in `draw`; render Three.js into an `OffscreenCanvas` and `ctx.drawImage` it. Renders use SwiftShader, so WebGL works without a GPU. The *3D* and *Kinetic type* templates show both.

- **Preview**: `/player` runs the project in a sandboxed iframe (no cookies, reached through a signed token in the URL, because agent-written code must not touch your session). The player draws scenes on a canvas and plays the score with Web Audio.
- **Render**: Playwright opens the same player headlessly, draws each frame by index and pipes PNG/JPEG frames into ffmpeg. The score is rendered with `OfflineAudioContext` and muxed in.
- **Long videos**: the timeline is cut at scene boundaries into chunks (short crossfades join a neighbour; pieces over 10 s are split). Chunks render in parallel browser pages, are cached by a hash of each scene's files (including the files it imports), the assets, the voice lines heard in it, the frame range and the framework version, and are joined with `ffmpeg -c copy`. Edit one scene and only the chunks that contain it render again.
- **Director**: a tool-calling loop against your model (`update_plan`, `list_files`, `read_file`, `search_files`, `write_file`, `edit_file`, `delete_file`, `commit`, `checkpoint`, `update_brand`, `fetch_url`, `check_video`, `capture_frame`, `view_reference`, `render_preview`, `render_final`, `run_command`, `remember`, `forget`, `list_voices`, `generate_voice`, `share_preview`). Each run is stored (status, steps, tokens); replies and thinking stream in, and a tab that opens mid-run picks up the live text. Changes are committed after each step.
- **Live updates** travel over one WebSocket per tab: chat tokens and thinking, run progress and token usage, tool progress, the plan, render progress, file changes, and the Director's terminal output.

### Security notes

- In the container the server runs as root and **everything the Director or the terminal runs is an unprivileged `sandbox` user**: commands (and git) cannot read the database, the encryption key or other users' renders, and cannot change the app. `data/` is traversable but not listable, so a project folder cannot be found without its id.
- API keys and secrets are encrypted at rest with AES-256-GCM.
- Commands run in the project folder with a timeout (60 s by default for the Director, at most 10 minutes); the interactive shell closes after 30 idle minutes.
- The container is the sandbox. Do not expose Luma Studio to people you would not give shell access to.

## Development

```bash
npm install
npm run build -w @luma/motion          # the framework (player + templates) is served from its dist/
npm run dev:server                     # http://localhost:3100 (needs ffmpeg and a Chromium: set CHROMIUM_PATH)
npm run dev:web                        # http://localhost:5173, proxies the API
npm test                               # unit tests (chunk planning, cache keys, redaction, voice timings, think tags, brand parsing, context trimming, fetch guard)
npm run typecheck
```

`e2e/` holds an end-to-end run of the whole journey against a running container, using scripted stand-ins for the model and ElevenLabs (`mock-llm.mjs`, `mock-elevenlabs.mjs`):

```bash
docker compose up --build -d
node e2e/mock-llm.mjs & node e2e/mock-elevenlabs.mjs &
MOCK_LLM_URL=http://host.docker.internal:4010/v1 node e2e/run-setup.mjs
MOCK_LLM_URL=http://host.docker.internal:4010/v1 node e2e/run.mjs
```

The journey covers sign-up and setup, the brief box, tool steps, preview, renders, history, zip uploads and the Director writing `brand.json`, thinking + plan + auto-check fixes + memory + checkpoints, the step limit with Continue and the message queue, terminals and secrets, voice-over, share links, the render cache, and logging out. Against `npm run dev:server` instead of Docker, set `LUMA_URL=http://localhost:3100`, `MOCK_LLM_URL=http://localhost:4010/v1` and start the server with `ELEVENLABS_BASE_URL=http://localhost:4020`.

(The container reaches the mocks through `host.docker.internal`; set `ELEVENLABS_BASE_URL=http://host.docker.internal:4020` for it.)

## Notes

- `brand/luma-icon.svg` (tile, favicon), `brand/luma-mark.svg` and `brand/luma-mark-white.svg` are the Luma Studio fan emblem, redrawn from the brand board. Replace them with the official SVGs if you have them and rebuild.
- The demo reel (`packages/motion/templates/demo`) is written for this framework in the same style as a hand-built canvas reel: Canvas 2D, hand-written easing, a Web Audio soundtrack, all driven by one time value.
