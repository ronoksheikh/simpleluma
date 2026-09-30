# Luma Studio

Chat with an AI motion designer that **makes motion-graphics videos in code**, shows a **live preview**, and **renders MP4s**.
Every video is its own git project. Self-hosted, one container.

```bash
docker compose up --build
```

Open <http://localhost:3000>, create an account, connect a model, and ask for "a 15-second Lumademy logo intro".
Everything lives in `./data`: the SQLite database and one git repository per video (`data/projects/<id>`).

The first build downloads a large base image (Chromium, fonts) and takes a few minutes. After that it starts in seconds.

## What you need

- Docker with Compose.
- An API key for an OpenAI-compatible model **with tool calling** (OpenRouter and OpenAI are presets; any compatible base URL works, including a local server).
- Optional: an [ElevenLabs](https://elevenlabs.io) key for voice-overs.

Optional environment variables (see `docker-compose.yml`): `LUMA_SECRET_KEY` encrypts stored keys with a secret of your choosing instead of a generated key file (`data/.secret-key`).

## Using it

1. **Sign up**, then connect a model. Paste a key and the model list loads by itself. *Test & save* asks the model to call a function, so a model without tool calling is rejected.
2. **New video** from the dashboard: a blank video, or the demo reel.
3. **Studio**: chat on the left, live preview on the right (play with sound, scrub, timecode). The preview refreshes whenever files change.
   Attach up to 20 images, SVGs or PDFs (the agent reads SVG colours and PDF text). Open the **terminal** dock at the bottom: *Terminal* is yours, *Agent* is a read-only live view of the commands the agent runs.
4. **Render** a *Quick preview* (480p) or a *Final* (1080p) with a live progress bar. Finished videos play in the page and can be downloaded.
5. **History** lists every change as a git commit, with its diff and a **Restore** button.
6. **Share** any live preview version or render with a link: random token, optional expiry, can be turned off. The link opens a clean full-screen player and needs no login.
7. **Settings**: model profiles, the ElevenLabs key (*Test* shows voices and remaining quota; *Save* unlocks after a passing test) and **Secrets**.

### Voice-over

With an ElevenLabs key saved, the agent can list your voices and generate each line **with word timestamps** (`audio/voice/<name>.mp3` + `.json`).
It times scenes to the words, and `captions()` lights up each word as it is spoken. Music ducks automatically under the voice. The **Audio** tab lists the voice files with players.

### Custom APIs

Save a named secret (for example `IMAGE_API_KEY`) in Settings. It is an environment variable in every terminal, so the agent can write and run a small script that calls another API and saves the result into `assets/`.
The model only ever sees secret **names**. Any secret value that appears in command output is replaced with `[secret:NAME]`.

## How it works

```
apps/web/          React + Vite + HeroUI v3 + Tailwind v4 + xterm.js
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
assets/             the user's attachments
```

Every frame depends only on the time `t`. Inside `draw`, `Math.random`, `Date.now` and `performance.now` throw; the framework provides `rng(seed)`, easing helpers, text/shape helpers and `captions()` (`import { ease, rng, text } from 'luma'`).

- **Preview**: `/player` runs the project in a sandboxed iframe (no cookies, reached through a signed token in the URL, because agent-written code must not touch your session). The player draws scenes on a canvas and plays the score with Web Audio.
- **Render**: Playwright opens the same player headlessly, draws each frame by index and pipes PNG/JPEG frames into ffmpeg. The score is rendered with `OfflineAudioContext` and muxed in.
- **Long videos**: the timeline is cut at scene boundaries into chunks (short crossfades join a neighbour; pieces over 10 s are split). Chunks render in parallel browser pages, are cached by a hash of each scene's files (including the files it imports), the assets, the voice lines heard in it, the frame range and the framework version, and are joined with `ffmpeg -c copy`. Edit one scene and only the chunks that contain it render again.
- **Agent**: a tool-calling loop against your model (`list_files`, `read_file`, `write_file`, `edit_file`, `commit`, `render_preview`, `render_final`, `capture_frame`, `run_command`, `list_voices`, `generate_voice`, `share_preview`). Replies stream in; each tool call is a card with live status. `capture_frame` returns a still (and numbers describing it) so the agent can check its work. Changes are committed after each step.
- **Live updates** travel over one WebSocket per tab: chat tokens, tool progress, render progress, file changes, and the agent's terminal output.

### Security notes

- In the container the server runs as root and **everything the agent or the terminal runs is an unprivileged `sandbox` user**: commands (and git) cannot read the database, the encryption key or other users' renders, and cannot change the app. `data/` is traversable but not listable, so a project folder cannot be found without its id.
- API keys and secrets are encrypted at rest with AES-256-GCM.
- Commands run in the project folder with a timeout (60 s by default for the agent, at most 10 minutes); the interactive shell closes after 30 idle minutes.
- The container is the sandbox. Do not expose Luma Studio to people you would not give shell access to.

## Development

```bash
npm install
npm run build -w @luma/motion          # the framework (player + templates) is served from its dist/
npm run dev:server                     # http://localhost:3100 (needs ffmpeg and a Chromium: set CHROMIUM_PATH)
npm run dev:web                        # http://localhost:5173, proxies the API
npm test                               # unit tests (chunk planning, cache keys, redaction, voice timings)
npm run typecheck
```

`e2e/` holds an end-to-end run of the whole journey against a running container, using scripted stand-ins for the model and ElevenLabs (`mock-llm.mjs`, `mock-elevenlabs.mjs`):

```bash
docker compose up --build -d
node e2e/mock-llm.mjs & node e2e/mock-elevenlabs.mjs &
MOCK_LLM_URL=http://host.docker.internal:4010/v1 node e2e/run.mjs
```

(The container reaches the mocks through `host.docker.internal`; set `ELEVENLABS_BASE_URL=http://host.docker.internal:4020` for it.)

## Notes

- `brand/Lumademy_Icon_Blue.svg` is the logo and favicon. The file in this repository is a **stand-in mark**: replace it with the official icon and rebuild.
- The demo reel (`packages/motion/templates/demo`) is written for this framework in the same style as a hand-built canvas reel: Canvas 2D, hand-written easing, a Web Audio soundtrack, all driven by one time value.
