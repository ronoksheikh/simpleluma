// A Three.js scene driven by a paused GSAP timeline: everything is computed from t, so preview and render match.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import gsap from 'gsap';
import { clamp, ease, text } from 'luma';

export const start = 0;
export const duration = 6;

const W = 1920;
const H = 1080;
const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(W, H), antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);

const blue = new THREE.MeshPhysicalMaterial({ color: '#2970EC', roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 });
const sky = new THREE.MeshPhysicalMaterial({ color: '#5DAEFF', roughness: 0.3, metalness: 0.05, clearcoat: 0.6 });
const cubes = [];
for (let i = 0; i < 9; i++) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.9, 0.9, 6, 0.18), i === 4 ? blue : sky);
  mesh.position.set(((i % 3) - 1) * 1.15, (Math.floor(i / 3) - 1) * 1.15, 0);
  scene.add(mesh);
  cubes.push(mesh);
}
scene.add(new THREE.HemisphereLight('#dbe9ff', '#0b1020', 1.2));
const key = new THREE.DirectionalLight('#ffffff', 2.4);
key.position.set(4, 6, 8);
scene.add(key);

// The timeline animates plain numbers; draw() seeks it to t and renders.
const s = { spread: 2.4, spin: -0.9, cam: 13, title: 0, out: 1 };
const tl = gsap.timeline({ paused: true });
tl.to(s, { spread: 1, duration: 1.6, ease: 'power3.out' }, 0.2)
  .to(s, { spin: 0.35, duration: 3.4, ease: 'power2.inOut' }, 0)
  .to(s, { cam: 9, duration: 2.2, ease: 'power3.inOut' }, 0.4)
  .to(s, { title: 1, duration: 0.9, ease: 'power3.out' }, 2.2)
  .to(s, { out: 0, duration: 0.6, ease: 'power2.in' }, 5.4);

export function draw(ctx, t, f) {
  tl.seek(t, false);
  cubes.forEach((c, i) => {
    const x = (i % 3) - 1;
    const y = Math.floor(i / 3) - 1;
    c.position.set(x * 1.15 * s.spread, y * 1.15 * s.spread, Math.sin(t * 1.4 + i) * 0.15 * s.spread);
    c.rotation.set(t * 0.3 + i * 0.2, t * 0.4, 0);
  });
  scene.rotation.set(0.35, s.spin, 0);
  camera.position.set(0, 0, s.cam);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);

  ctx.globalAlpha = s.out;
  ctx.drawImage(renderer.domElement, -260, 0, f.width, f.height);
  const k = ease.outCubic(clamp(s.title));
  ctx.globalAlpha = k * s.out;
  text(ctx, 'Built in 3D', 1180, 470 + (1 - k) * 30, { size: 112, weight: 600, color: '#FFFFFF', tracking: -2 });
  text(ctx, 'Three.js + GSAP, frame-exact', 1184, 580 + (1 - k) * 30, { size: 40, weight: 400, color: '#5DAEFF' });
}
