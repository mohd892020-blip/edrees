/**
 * Procedural surfaces for the 3D world: canvas textures turned into PBR maps
 * (colour, normal, roughness). Nothing here loads an image file.
 */
import * as THREE from 'three';
import { makeCanvas, ValueNoise, pixelField, clamp, smoothstep, hex, mixRGB } from '../render/texture.js';

const srgb = THREE.SRGBColorSpace;

export function toTexture(canvas, { color = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = srgb;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

/** Normal map from a canvas, treating brightness as height (Sobel filter). */
export function normalFrom(src, strength = 2, size = 0) {
  const w = size || src.width;
  const h = size || src.height;
  const tmp = makeCanvas(w, h);
  const tc = tmp.getContext('2d', { willReadFrequently: true });
  tc.drawImage(src, 0, 0, w, h);
  const d = tc.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  }
  const out = makeCanvas(w, h);
  const oc = out.getContext('2d');
  const img = oc.createImageData(w, h);
  const o = img.data;
  const at = (x, y) => lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const s = strength * (w / 512);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * s;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * s;
      const len = Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      o[k] = (-dx / len) * 127.5 + 127.5;
      o[k + 1] = (dy / len) * 127.5 + 127.5;
      o[k + 2] = (1 / len) * 127.5 + 127.5;
      o[k + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  return out;
}

function noiseTile(size, seed, scale, octaves = 3) {
  const n = new ValueNoise(seed);
  return pixelField(size, size, (u, v, o) => {
    // Blending four offset samples makes the tile repeat seamlessly.
    const a = n.fbm(u * scale, v * scale, octaves);
    const b = n.fbm((u - 1) * scale, v * scale, octaves);
    const c = n.fbm(u * scale, (v - 1) * scale, octaves);
    const d = n.fbm((u - 1) * scale, (v - 1) * scale, octaves);
    const top = a * (1 - u) + b * u;
    const bot = c * (1 - u) + d * u;
    const g = (top * (1 - v) + bot * v) * 255;
    o[0] = g;
    o[1] = g;
    o[2] = g;
  });
}

// ───────────────────────── board tops ─────────────────────────

/**
 * Paints a board top covering [-half, half]². Returns colour, height and
 * roughness canvases painted by `paint(c, h, r)` in world units.
 */
function layered(size, half, paint) {
  const mk = (fill) => {
    const c = makeCanvas(size, size);
    const x = c.getContext('2d');
    x.fillStyle = fill;
    x.fillRect(0, 0, size, size);
    const k = size / (2 * half);
    x.setTransform(k, 0, 0, k, size / 2, size / 2);
    return x;
  };
  const color = mk('#000');
  const height = mk('#808080');
  const rough = mk('#808080');
  paint(color, height, rough);
  return { color: color.canvas, height: height.canvas, rough: rough.canvas };
}

const GRID_V = [-1.5, -0.5, 0.5, 1.5];

function gridStroke(ctx, style, w) {
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const v of GRID_V) {
    ctx.moveTo(-1.5, v);
    ctx.lineTo(1.5, v);
    ctx.moveTo(v, -1.5);
    ctx.lineTo(v, 1.5);
  }
  ctx.stroke();
}

/** Figured walnut playing field framed in dark ebony, with carved grooves. */
export function woodTop(size, half) {
  const noise = new ValueNoise(11);
  const light = hex('#2e2a2e');
  const mid = hex('#17151a');
  const deep = hex('#060608');
  const field = pixelField(size >> 1, size >> 1, (u, v, o) => {
    const x = (u - 0.5) * 2 * half;
    const y = (v - 0.5) * 2 * half;
    const warp = noise.fbm(x * 0.42 + 3.1, y * 1.5, 4);
    const t = y * 2.4 + warp * 3.8 + Math.sin(x * 0.8) * 0.3;
    const ring = t - Math.floor(t);
    const band = Math.pow(Math.abs(Math.sin(ring * Math.PI)), 0.55);
    const fiber = noise.noise(x * 2.6, y * 75) * 0.55 + noise.noise(x * 1.1, y * 28) * 0.45;
    const m = clamp(0.2 + 0.55 * (1 - band) + (fiber - 0.5) * 0.45);
    mixRGB(light, mid, m, o);
    mixRGB(o, deep, smoothstep(0.58, 0.82, noise.fbm(x * 0.3 + 9, y * 4.5, 3)) * 0.65, o);
  });
  const dark = hex('#0d0e12');
  const darker = hex('#040507');
  const frame = pixelField(size >> 1, size >> 1, (u, v, o) => {
    const x = (u - 0.5) * 2 * half;
    const y = (v - 0.5) * 2 * half;
    mixRGB(dark, darker, clamp(noise.fbm(x * 0.5 + 20, y * 7, 4) * 1.5 - 0.3), o);
  });
  const F = 1.66;
  return layered(size, half, (c, h, r) => {
    c.drawImage(frame, -half, -half, 2 * half, 2 * half);
    h.drawImage(frame, -half, -half, 2 * half, 2 * half);
    h.globalAlpha = 0.5;
    h.fillStyle = '#808080';
    h.fillRect(-half, -half, 2 * half, 2 * half);
    h.globalAlpha = 1;
    // The field sits in the frame, slightly recessed.
    c.drawImage(field, -F, -F, 2 * F, 2 * F);
    h.fillStyle = '#707070';
    h.fillRect(-F, -F, 2 * F, 2 * F);
    h.globalAlpha = 0.28;
    h.drawImage(field, -F, -F, 2 * F, 2 * F);
    h.globalAlpha = 1;
    // Lacquer: the field is glossier than the frame.
    r.fillStyle = '#5a5a5a';
    r.fillRect(-half, -half, 2 * half, 2 * half);
    r.fillStyle = '#3c3c3c';
    r.fillRect(-F, -F, 2 * F, 2 * F);
    // Carved grooves.
    h.save();
    h.filter = `blur(${size / 700}px)`;
    gridStroke(h, '#0a0a0a', 0.085);
    h.restore();
    gridStroke(c, 'rgba(10,3,0,0.9)', 0.06);
    gridStroke(r, '#b0b0b0', 0.07);
  });
}

/** Carrara marble field inside a black Marquina frame. */
export function marbleTop(size, half) {
  const noise = new ValueNoise(23);
  const base = hex('#fbfbfd');
  const warm = hex('#eceef4');
  const vein = hex('#7b8294');
  const field = pixelField(size >> 1, size >> 1, (u, v, o) => {
    const x = (u - 0.5) * 2 * half;
    const y = (v - 0.5) * 2 * half;
    const cloud = noise.fbm(x * 0.6 + 10, y * 0.6, 4);
    const t1 = x * 1.1 + y * 0.65 + noise.fbm(x * 0.7, y * 0.7, 5) * 4.4;
    const v1 = Math.pow(1 - Math.abs(Math.sin(t1 * Math.PI * 0.8)), 11);
    const t2 = x * 0.3 - y * 1.1 + noise.fbm(x * 1.6 + 7, y * 1.6 + 3, 4) * 3.2;
    const v2 = Math.pow(1 - Math.abs(Math.sin(t2 * Math.PI * 1.3)), 28) * 0.55;
    mixRGB(base, warm, smoothstep(0.42, 0.75, cloud) * 0.6, o);
    mixRGB(o, vein, clamp(v1 * 0.72 + v2), o);
  });
  const blackA = hex('#03040a');
  const blackB = hex('#0a0e1e');
  const white = hex('#cfd6e6');
  const frame = pixelField(size >> 1, size >> 1, (u, v, o) => {
    const x = (u - 0.5) * 2 * half;
    const y = (v - 0.5) * 2 * half;
    mixRGB(blackA, blackB, noise.fbm(x * 1.1 + 31, y * 1.1, 4), o);
    const t = x * 0.8 - y * 1.2 + noise.fbm(x * 0.9 + 40, y * 0.9 + 8, 5) * 5;
    mixRGB(o, white, Math.pow(1 - Math.abs(Math.sin(t * Math.PI)), 34) * 0.9, o);
  });
  const F = 1.66;
  return layered(size, half, (c, h, r) => {
    c.drawImage(frame, -half, -half, 2 * half, 2 * half);
    c.drawImage(field, -F, -F, 2 * F, 2 * F);
    r.fillStyle = '#2a2a2a';
    r.fillRect(-half, -half, 2 * half, 2 * half);
    gridStroke(c, 'rgba(10,16,40,0.45)', 0.04); // bed under the gold strips
  });
}

/** Black glass with a faint starfield. */
export function glassTop(size, half) {
  const noise = new ValueNoise(71);
  const a = hex('#070a18');
  const b = hex('#10163a');
  const field = pixelField(size >> 1, size >> 1, (u, v, o) => {
    mixRGB(a, b, noise.fbm(u * 4, v * 4, 4) * 1.1, o);
  });
  return layered(size, half, (c, h, r) => {
    c.drawImage(field, -half, -half, 2 * half, 2 * half);
    const rng = new ValueNoise(5);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(190,220,255,${0.08 + rng.noise(i, 1) * 0.4})`;
      const x = (rng.noise(i * 1.7, 3) - 0.5) * 2.4 * half;
      const y = (rng.noise(i * 2.3, 7) - 0.5) * 2.4 * half;
      const s = 0.004 + rng.noise(i, 9) * 0.01;
      c.fillRect(x, y, s, s);
    }
    r.fillStyle = '#121212';
    r.fillRect(-half, -half, 2 * half, 2 * half);
  });
}

// ───────────────────────── tables ─────────────────────────

/** Woven cloth for tables and pedestal tops. */
export function fabricMaps(colorA, colorB, seed = 3) {
  const size = 256;
  const n = noiseTile(size, seed, 40, 3);
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  x.globalAlpha = 0.28;
  x.globalCompositeOperation = 'overlay';
  x.drawImage(n, 0, 0);
  const weave = makeCanvas(size, size);
  const w = weave.getContext('2d');
  w.drawImage(n, 0, 0);
  w.globalAlpha = 0.5;
  for (let i = 0; i < size; i += 4) {
    w.fillStyle = i % 8 ? '#000' : '#fff';
    w.fillRect(i, 0, 2, size);
    w.fillRect(0, i, size, 2);
  }
  return { color: c, normal: normalFrom(weave, 1.6) };
}

/** Lacquered dark wood table with a long grain. */
export function lacquerMaps(a, b, seed = 9) {
  const noise = new ValueNoise(seed);
  const ca = hex(a);
  const cb = hex(b);
  const c = pixelField(512, 512, (u, v, o) => {
    const t = v * 14 + noise.fbm(u * 2, v * 8, 4) * 5;
    mixRGB(ca, cb, 0.5 + 0.5 * Math.sin(t * 2.2 + noise.noise(u * 3, v * 60) * 1.4), o);
  });
  return { color: c };
}

/** Dark floor with a thin glowing grid, for the neon night. */
export function neonFloorMaps() {
  const size = 1024;
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  x.fillStyle = '#05040f';
  x.fillRect(0, 0, size, size);
  x.strokeStyle = 'rgba(255,61,245,0.35)';
  x.lineWidth = 2;
  const step = size / 10;
  x.beginPath();
  for (let i = 0; i <= 10; i++) {
    x.moveTo(i * step, 0);
    x.lineTo(i * step, size);
    x.moveTo(0, i * step);
    x.lineTo(size, i * step);
  }
  x.stroke();
  return { color: c };
}

/** Soft rounded square used as an alpha mask for cell highlights. */
export function glowTile(size = 256, fill = 0.82) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const m = size * ((1 - fill) / 2);
  const s = size - 2 * m;
  x.shadowColor = '#fff';
  x.shadowBlur = size * 0.09;
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.beginPath();
  x.roundRect(m, m, s, s, size * 0.1);
  x.fill();
  x.lineWidth = size * 0.022;
  x.strokeStyle = '#fff';
  x.stroke();
  return c;
}

/** Soft round dot for particles and halos. */
export function dotTile(size = 64) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

/** A soft ring (selection markers, impacts). */
export function ringTile(size = 256) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  x.shadowColor = '#fff';
  x.shadowBlur = size * 0.05;
  x.strokeStyle = '#fff';
  x.lineWidth = size * 0.035;
  x.beginPath();
  x.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  x.stroke();
  return c;
}

/** Red cross for forbidden placements. */
export function crossTile(size = 256) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  x.strokeStyle = '#fff';
  x.lineCap = 'round';
  x.lineWidth = size * 0.05;
  x.shadowColor = '#fff';
  x.shadowBlur = size * 0.05;
  const a = size * 0.33;
  const b = size * 0.67;
  x.beginPath();
  x.moveTo(a, a);
  x.lineTo(b, b);
  x.moveTo(b, a);
  x.lineTo(a, b);
  x.stroke();
  return c;
}
