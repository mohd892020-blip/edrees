/**
 * Procedural texture helpers (noise, pixel fields, shapes) shared by board
 * themes and piece painters. No image files are used anywhere.
 */
import { mulberry32 } from '../core/rng.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Smooth 2D value noise with fractal Brownian motion. */
export class ValueNoise {
  constructor(seed = 1) {
    const rng = mulberry32(seed);
    this.v = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.v[i] = rng();
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }

  _at(ix, iy) {
    return this.v[this.p[(ix & 255) + this.p[iy & 255]]];
  }

  noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this._at(ix, iy);
    const b = this._at(ix + 1, iy);
    const c = this._at(ix, iy + 1);
    const d = this._at(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  fbm(x, y, octaves = 4) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
}

/**
 * Renders a w×h canvas by calling `fn(u, v, out)` for every pixel, where u, v
 * are in [0, 1) and `out` receives [r, g, b, a] (0–255).
 */
export function pixelField(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x / w, y / h, out);
      d[k++] = out[0];
      d[k++] = out[1];
      d[k++] = out[2];
      d[k++] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** A small tile of random specks, used as a repeating grain pattern. */
export function grainTile(size, seed, colors, density = 0.35, maxR = 1.2) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rng = mulberry32(seed);
  const count = Math.floor(size * size * density * 0.05);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const r = 0.4 + rng() * maxR;
    ctx.globalAlpha = 0.25 + rng() * 0.6;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixRGB(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Points along a rounded square centred at the origin (for projecting). */
export function roundRectPoints(x0, y0, x1, y1, r, perCorner = 6) {
  const pts = [];
  const corners = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

/** Smooth closed curve through points (quadratic midpoints). */
export function smoothClosedPath(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

/** The 3×3 grid as line segments in world units (outer square + inner lines). */
export const GRID_SEGMENTS = (() => {
  const s = [];
  for (const v of [-1.5, -0.5, 0.5, 1.5]) {
    s.push([-1.5, v, 1.5, v]);
    s.push([v, -1.5, v, 1.5]);
  }
  return s;
})();

export function strokeSegments(ctx, segs, dx = 0, dy = 0) {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) {
    ctx.moveTo(x1 + dx, y1 + dy);
    ctx.lineTo(x2 + dx, y2 + dy);
  }
  ctx.stroke();
}

/** An 8-pointed star (khatam) path. */
export function starPath(ctx, cx, cy, r, points = 8, inner = 0.55, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
