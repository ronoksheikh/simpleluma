import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const server = process.env.LUMA_SERVER ?? 'http://localhost:3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The brand folder is served at the site root, so the logo doubles as the favicon.
  publicDir: resolve(import.meta.dirname, '../../brand'),
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/t': server,
      '/motion': server,
      '/player': server,
      '/ws': { target: server, ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
