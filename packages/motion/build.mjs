import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

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
await cp('static/player.css', `${out}/player.css`);
for (const subset of ['latin', 'latin-ext']) {
  await cp(`../../node_modules/@fontsource-variable/inter/files/inter-${subset}-opsz-normal.woff2`, `${out}/fonts/inter-${subset}-opsz-normal.woff2`);
}
await cp('templates', 'dist/templates', { recursive: true });

// Libraries scenes may import: Three.js (with its addons) and GSAP (with every plugin), served next to the player.
const modules = '../../node_modules';
await mkdir(`${out}/vendor/three/build`, { recursive: true });
for (const file of ['three.module.js', 'three.core.js', 'three.webgpu.js', 'three.tsl.js', 'three.webgpu.nodes.js']) {
  await cp(`${modules}/three/build/${file}`, `${out}/vendor/three/build/${file}`);
}
await cp(`${modules}/three/examples/jsm`, `${out}/vendor/three/examples/jsm`, { recursive: true });
await cp(`${modules}/gsap`, `${out}/vendor/gsap`, { recursive: true, filter: (src) => !/[\\/](dist|types|src)$/.test(src) && !src.endsWith('.md') });

const gsapFiles = (await readdir(`${modules}/gsap`)).filter((f) => f.endsWith('.js'));
const imports = {
  luma: '/motion/lib.js',
  three: '/motion/vendor/three/build/three.module.js',
  'three/webgpu': '/motion/vendor/three/build/three.webgpu.js',
  'three/tsl': '/motion/vendor/three/build/three.tsl.js',
  'three/addons/': '/motion/vendor/three/examples/jsm/',
  'three/examples/jsm/': '/motion/vendor/three/examples/jsm/',
  gsap: '/motion/vendor/gsap/index.js',
  ...Object.fromEntries(gsapFiles.flatMap((f) => [[`gsap/${f}`, `/motion/vendor/gsap/${f}`], [`gsap/${f.slice(0, -3)}`, `/motion/vendor/gsap/${f}`]])),
};
const html = (await readFile('static/player.html', 'utf8')).replace('__IMPORT_MAP__', JSON.stringify({ imports }));
await writeFile(`${out}/player.html`, html);
