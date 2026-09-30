import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const out = 'dist/web';
await build({
  entryPoints: { lib: 'src/lib.ts', player: 'src/player/player.ts' },
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
});

await mkdir(`${out}/fonts`, { recursive: true });
await cp('static/player.html', `${out}/player.html`);
await cp('static/player.css', `${out}/player.css`);
for (const subset of ['latin', 'latin-ext']) {
  await cp(`../../node_modules/@fontsource-variable/inter/files/inter-${subset}-opsz-normal.woff2`, `${out}/fonts/inter-${subset}-opsz-normal.woff2`);
}
await cp('templates', 'dist/templates', { recursive: true });
