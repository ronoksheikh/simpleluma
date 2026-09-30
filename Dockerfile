# syntax=docker/dockerfile:1

# ---- build: compile the framework, the web app and the server ---------------------------------
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/motion/package.json packages/motion/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: Node 22 + Chromium (Playwright's image) + ffmpeg, git, python3, curl, fonts ---------
FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && rm -rf /ms-playwright/firefox-* /ms-playwright/webkit-*
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git python3 curl poppler-utils fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# Commands run by the agent and the terminal use this unprivileged user (see README, "Security").
RUN useradd --create-home --uid 1500 --shell /bin/bash sandbox \
 && git config --system --add safe.directory '*' \
 && git config --system user.name 'Luma Studio' \
 && git config --system user.email 'studio@luma.local'

WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
VOLUME /app/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "apps/server/dist/index.js"]
