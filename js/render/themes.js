/**
 * The five board themes. Each theme paints:
 *  - `backdrop(ctx, w, h)`  : screen-space background behind everything;
 *  - `paintWorld(ctx, env)` : the board plane in world units (table/ground + board),
 *                             later projected in perspective by the renderer;
 *  - `edge`                 : colours of the slab's front face (if the board is a slab);
 *  - `overlay(...)`         : optional animated layer (neon flicker).
 */
import {
  makeCanvas, ValueNoise, pixelField, grainTile, clamp, smoothstep, hex, mixRGB,
  roundRectPath, GRID_SEGMENTS, strokeSegments, starPath,
} from './texture.js';
import { mulberry32 } from '../core/rng.js';

const TAU = Math.PI * 2;

/** Pixel-field resolution scaled by texture quality (small previews stay fast). */
const res = (n, q) => Math.max(96, Math.round(n * q));

/** Run `fn` with an identity transform (pixel space), e.g. for repeating patterns. */
function pixelSpace(ctx, fn) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fn();
  ctx.restore();
}

function overlayGrain(ctx, tile, alpha, composite = 'source-over') {
  pixelSpace(ctx, () => {
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = composite;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  });
}

function slabShadow(ctx, slab, k, color = 'rgba(0,0,0,0.7)') {
  const { half: H, radius: r } = slab;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 0.24 * k;
  ctx.shadowOffsetX = 0.05 * k;
  ctx.shadowOffsetY = 0.18 * k;
  roundRectPath(ctx, -H, -H, 2 * H, 2 * H, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

function slabClip(ctx, slab) {
  const { half: H, radius: r } = slab;
  roundRectPath(ctx, -H, -H, 2 * H, 2 * H, r);
  ctx.clip();
}

function bevel(ctx, slab, light = 'rgba(255,236,200,0.55)', dark = 'rgba(0,0,0,0.55)', w = 0.05) {
  const { half: H, radius: r } = slab;
  const g = ctx.createLinearGradient(-H, -H, H, H);
  g.addColorStop(0, light);
  g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, dark);
  ctx.strokeStyle = g;
  ctx.lineWidth = w;
  roundRectPath(ctx, -H + w / 2, -H + w / 2, 2 * H - w, 2 * H - w, r);
  ctx.stroke();
}

function lighting(ctx, H, strength = 1) {
  const g = ctx.createLinearGradient(-H, -H, H, H);
  g.addColorStop(0, `rgba(255,240,215,${0.16 * strength})`);
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.24 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(-H, -H, 2 * H, 2 * H);
  const r = ctx.createRadialGradient(-0.7, -0.9, 0, -0.7, -0.9, 3.2);
  r.addColorStop(0, `rgba(255,245,225,${0.14 * strength})`);
  r.addColorStop(1, 'rgba(255,245,225,0)');
  ctx.fillStyle = r;
  ctx.fillRect(-H, -H, 2 * H, 2 * H);
}

function radialBackdrop(ctx, w, h, stops, cy = 0.46) {
  const g = ctx.createRadialGradient(w / 2, h * cy, 0, w / 2, h * cy, Math.hypot(w, h) * 0.62);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

const gridPath = (ctx, segs = GRID_SEGMENTS, dx = 0, dy = 0) => {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) {
    ctx.moveTo(x1 + dx, y1 + dy);
    ctx.lineTo(x2 + dx, y2 + dy);
  }
};

// ───────────────────────────── 1. Carved luxury wood ─────────────────────────────

const wood = {
  id: 'wood',
  name: 'أبنوس وذهب',
  surface: 'wood',
  seed: 11,
  slab: { half: 1.8, radius: 0.14, thickness: 0.26 },
  edge: { top: '#7a4522', bottom: '#2a1407', grain: true, line: 'rgba(255,214,160,0.35)' },
  highlight: [255, 214, 140],
  win: [255, 200, 90],
  particles: ['#d9ae75', '#9b6a3c', '#f0d29d'],
  ui: { accent: '#f6e3ae', accent2: '#b09a68', glow: 'rgba(246,227,174,0.42)' },

  backdrop(ctx, w, h) {
    radialBackdrop(ctx, w, h, [[0, '#24503d'], [0.55, '#122b20'], [1, '#050d0a']]);
  },

  paintWorld(ctx, { E, k, noise, rng, q }) {
    // Green baize table.
    const felt = pixelField(res(256, q), res(256, q), (u, v, o) => {
      const n = noise.fbm(u * 22, v * 22, 3);
      const b = 0.82 + n * 0.32;
      o[0] = 28 * b;
      o[1] = 66 * b;
      o[2] = 50 * b;
    });
    ctx.drawImage(felt, -E, -E, 2 * E, 2 * E);
    overlayGrain(ctx, grainTile(96, 3, ['#0a1d15', '#3b6d57'], 0.9, 0.7), 0.35);

    const slab = this.slab;
    const H = slab.half;
    slabShadow(ctx, slab, k);

    // Walnut slab with flowing grain.
    const light = hex('#b0723f');
    const dark = hex('#5e3419');
    const deep = hex('#3a1d0b');
    const woodTex = pixelField(res(560, q), res(560, q), (u, v, o) => {
      const x = (u - 0.5) * 2 * H;
      const y = (v - 0.5) * 2 * H;
      const warp = noise.fbm(x * 0.42 + 3.1, y * 1.5, 4);
      const t = y * 2.6 + warp * 3.6 + Math.sin(x * 0.8) * 0.3;
      const ring = t - Math.floor(t);
      const band = Math.pow(Math.abs(Math.sin(ring * Math.PI)), 0.55);
      const fiber = noise.noise(x * 2.6, y * 75) * 0.55 + noise.noise(x * 1.1, y * 28) * 0.45;
      const m = clamp(0.18 + 0.55 * (1 - band) + (fiber - 0.5) * 0.4);
      mixRGB(light, dark, m, o);
      const streak = smoothstep(0.6, 0.82, noise.fbm(x * 0.3 + 9, y * 4.5, 3)) * 0.55;
      mixRGB(o, deep, streak, o);
    });
    ctx.save();
    slabClip(ctx, slab);
    ctx.drawImage(woodTex, -H, -H, 2 * H, 2 * H);
    // Fine pores.
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#2a1206';
    ctx.lineWidth = 0.004;
    for (let i = 0; i < 260; i++) {
      const y = -H + rng() * 2 * H;
      const x = -H + rng() * 2 * H;
      const len = 0.05 + rng() * 0.25;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + (rng() - 0.5) * 0.01);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    lighting(ctx, H, 1.1);

    // Brass inlay border with small khatam stars at its corners.
    const B = 1.66;
    const brass = ctx.createLinearGradient(-B, -B, B, B);
    brass.addColorStop(0, '#fff0b8');
    brass.addColorStop(0.3, '#c9973c');
    brass.addColorStop(0.6, '#f3d58a');
    brass.addColorStop(1, '#8a5c1c');
    ctx.strokeStyle = 'rgba(30,12,2,0.7)';
    ctx.lineWidth = 0.034;
    roundRectPath(ctx, -B, -B, 2 * B, 2 * B, 0.08);
    ctx.stroke();
    ctx.strokeStyle = brass;
    ctx.lineWidth = 0.018;
    ctx.stroke();
    for (const [sx, sy] of [[-B, -B], [B, -B], [B, B], [-B, B], [0, -B], [0, B], [-B, 0], [B, 0]]) {
      const corner = sx !== 0 && sy !== 0;
      starPath(ctx, sx, sy, corner ? 0.075 : 0.05, 8, 0.6, corner ? 0 : Math.PI / 8);
      ctx.fillStyle = 'rgba(30,12,2,0.75)';
      ctx.save();
      ctx.translate(0.008, 0.01);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = brass;
      ctx.fill();
    }

    // Carved grid: groove, shadowed upper wall, lit lower wall.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,214,160,0.28)';
    ctx.lineWidth = 0.03;
    strokeSegments(ctx, GRID_SEGMENTS, 0.024, 0.028);
    ctx.strokeStyle = '#2a1407';
    ctx.lineWidth = 0.072;
    strokeSegments(ctx, GRID_SEGMENTS);
    ctx.strokeStyle = 'rgba(10,3,0,0.75)';
    ctx.lineWidth = 0.034;
    strokeSegments(ctx, GRID_SEGMENTS, -0.012, -0.014);
    ctx.strokeStyle = 'rgba(160,100,55,0.35)';
    ctx.lineWidth = 0.014;
    strokeSegments(ctx, GRID_SEGMENTS, 0.014, 0.016);

    // Mother-of-pearl inlays at the grid intersections.
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
      for (const y of [-1.5, -0.5, 0.5, 1.5]) {
        ctx.beginPath();
        ctx.arc(x, y, 0.05, 0, TAU);
        ctx.fillStyle = '#1c0b02';
        ctx.fill();
        const g = ctx.createRadialGradient(x - 0.015, y - 0.018, 0.003, x, y, 0.04);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.45, '#e5eef7');
        g.addColorStop(0.75, '#c9d3f0');
        g.addColorStop(1, '#a9b7c9');
        ctx.beginPath();
        ctx.arc(x, y, 0.038, 0, TAU);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
    ctx.restore();
    bevel(ctx, slab, 'rgba(255,220,170,0.6)', 'rgba(20,6,0,0.7)', 0.06);
  },
};

// ───────────────────────────── 2. Marble with gold ─────────────────────────────

function goldStroke(ctx, pathFn, w, H) {
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  pathFn();
  ctx.strokeStyle = 'rgba(70,46,12,0.55)';
  ctx.lineWidth = w * 1.7;
  ctx.stroke();
  const g = ctx.createLinearGradient(-H, -H * 0.7, H, H * 0.8);
  g.addColorStop(0, '#8a5d14');
  g.addColorStop(0.18, '#f7dc8c');
  g.addColorStop(0.36, '#b98727');
  g.addColorStop(0.55, '#fff1b8');
  g.addColorStop(0.75, '#a87516');
  g.addColorStop(1, '#e7c36a');
  ctx.strokeStyle = g;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.save();
  ctx.translate(-w * 0.2, -w * 0.2);
  pathFn();
  ctx.strokeStyle = 'rgba(255,250,225,0.7)';
  ctx.lineWidth = w * 0.26;
  ctx.stroke();
  ctx.restore();
}

const marble = {
  id: 'marble',
  name: 'رخام وذهب',
  surface: 'marble',
  seed: 23,
  slab: { half: 1.8, radius: 0.08, thickness: 0.24 },
  edge: { top: '#ece9e3', bottom: '#8f8a83', line: '#d9b45a' },
  highlight: [255, 214, 120],
  win: [255, 196, 60],
  particles: ['#ffffff', '#efe9dc', '#e5c56b'],
  ui: { accent: '#f6e3ae', accent2: '#b09a68', glow: 'rgba(246,227,174,0.42)' },

  backdrop(ctx, w, h) {
    radialBackdrop(ctx, w, h, [[0, '#2a2a33'], [0.6, '#15151b'], [1, '#060608']]);
  },

  paintWorld(ctx, { E, k, noise, q }) {
    const velvet = pixelField(res(256, q), res(256, q), (u, v, o) => {
      const n = noise.fbm(u * 10 + 40, v * 10, 4);
      const b = 0.75 + n * 0.5;
      o[0] = 30 * b;
      o[1] = 30 * b;
      o[2] = 38 * b;
    });
    ctx.drawImage(velvet, -E, -E, 2 * E, 2 * E);
    overlayGrain(ctx, grainTile(96, 5, ['#08080b', '#3c3c48'], 0.9, 0.6), 0.3);

    const slab = this.slab;
    const H = slab.half;
    slabShadow(ctx, slab, k);

    const base = hex('#f6f4ef');
    const warm = hex('#e6dccd');
    const vein = hex('#6f737d');
    const tex = pixelField(res(560, q), res(560, q), (u, v, o) => {
      const x = (u - 0.5) * 2 * H;
      const y = (v - 0.5) * 2 * H;
      const cloud = noise.fbm(x * 0.6 + 10, y * 0.6, 4);
      const t1 = x * 1.1 + y * 0.65 + noise.fbm(x * 0.7, y * 0.7, 5) * 4.4;
      const v1 = Math.pow(1 - Math.abs(Math.sin(t1 * Math.PI * 0.8)), 11);
      const t2 = x * 0.3 - y * 1.1 + noise.fbm(x * 1.6 + 7, y * 1.6 + 3, 4) * 3.2;
      const v2 = Math.pow(1 - Math.abs(Math.sin(t2 * Math.PI * 1.3)), 28) * 0.55;
      mixRGB(base, warm, smoothstep(0.42, 0.75, cloud) * 0.6, o);
      mixRGB(o, vein, clamp(v1 * 0.7 + v2), o);
      const b = 0.965 + cloud * 0.05;
      o[0] *= b;
      o[1] *= b;
      o[2] *= b;
    });
    ctx.save();
    slabClip(ctx, slab);
    ctx.drawImage(tex, -H, -H, 2 * H, 2 * H);
    lighting(ctx, H, 0.8);
    // Polished reflection.
    const gl = ctx.createLinearGradient(-H, -H, -H + 1.6, -H + 2.2);
    gl.addColorStop(0, 'rgba(255,255,255,0.22)');
    gl.addColorStop(0.6, 'rgba(255,255,255,0.05)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(-H, -H, 2 * H, 2 * H);

    // Gold: double frame, grid and corner rosettes.
    goldStroke(ctx, () => roundRectPath(ctx, -1.7, -1.7, 3.4, 3.4, 0.04), 0.022, H);
    goldStroke(ctx, () => gridPath(ctx), 0.046, H);
    for (const [x, y] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) {
      starPath(ctx, x, y, 0.12, 8, 0.5, Math.PI / 8);
      ctx.fillStyle = 'rgba(70,46,12,0.55)';
      ctx.fill();
      const g = ctx.createRadialGradient(x - 0.03, y - 0.04, 0.01, x, y, 0.12);
      g.addColorStop(0, '#fff4c4');
      g.addColorStop(0.5, '#d9ad45');
      g.addColorStop(1, '#8a5d14');
      starPath(ctx, x, y, 0.1, 8, 0.5, Math.PI / 8);
      ctx.fillStyle = g;
      ctx.fill();
    }
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        ctx.beginPath();
        ctx.arc(x, y, 0.05, 0, TAU);
        const g = ctx.createRadialGradient(x - 0.015, y - 0.02, 0.005, x, y, 0.05);
        g.addColorStop(0, '#fff6cf');
        g.addColorStop(0.6, '#d3a43f');
        g.addColorStop(1, '#7c5410');
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
    ctx.restore();
    bevel(ctx, slab, 'rgba(255,255,255,0.85)', 'rgba(60,55,50,0.6)', 0.05);
  },
};

// ───────────────────────────── 3. Finger-drawn sand ─────────────────────────────

function wobbly(noise, x1, y1, x2, y2, seed, overshoot = 0.06) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const sx = x1 - ux * overshoot * (0.5 + noise.noise(seed, 1));
  const sy = y1 - uy * overshoot * (0.5 + noise.noise(seed, 2));
  const ex = x2 + ux * overshoot * (0.5 + noise.noise(seed, 3));
  const ey = y2 + uy * overshoot * (0.5 + noise.noise(seed, 4));
  const L = Math.hypot(ex - sx, ey - sy);
  const n = Math.ceil(L / 0.05);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = (noise.fbm(t * 2.2 + seed * 3.7, seed * 1.3, 2) - 0.5) * 0.11;
    pts.push([sx + (ex - sx) * t - uy * off, sy + (ey - sy) * t + ux * off]);
  }
  return pts;
}

/** Sinks the rim of a ground into the dark room, so its edge never shows. */
function fadeToNight(ctx, E) {
  if (E <= 3.2) return;
  const g = ctx.createRadialGradient(0, 0, E * 0.6, 0, 0, E * 0.96);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(-E, -E, 2 * E, 2 * E);
}

const sand = {
  id: 'sand',
  name: 'رمال القمر',
  surface: 'sand',
  seed: 37,
  slab: null,
  highlight: [235, 242, 255],
  win: [255, 236, 170],
  particles: ['#cfd8ea', '#9fb0d0', '#eef2fb'],
  ui: { accent: '#dfe8ff', accent2: '#7f93c4', glow: 'rgba(223,232,255,0.5)' },

  backdrop(ctx, w, h) {
    radialBackdrop(ctx, w, h, [[0, '#2a3558'], [0.6, '#141d3a'], [1, '#070b1c']]);
  },

  paintWorld(ctx, { E, k, noise, rng, q }) {
    const a = hex('#bcc6da');
    const b = hex('#8a97b4');
    const field = pixelField(res(600, q), res(600, q), (u, v, o) => {
      const x = (u - 0.5) * 2 * E;
      const y = (v - 0.5) * 2 * E;
      mixRGB(a, b, noise.fbm(x * 0.32, y * 0.32, 4), o);
      const rip = Math.sin((y * 2.1 + x * 0.42 + noise.fbm(x * 0.4 + 5, y * 0.4, 3) * 2.4) * TAU);
      const s = 1 + rip * 0.032 + (noise.noise(x * 11, y * 11) - 0.5) * 0.07;
      o[0] *= s;
      o[1] *= s;
      o[2] *= s;
    });
    ctx.drawImage(field, -E, -E, 2 * E, 2 * E);
    overlayGrain(ctx, grainTile(128, 9, ['#5c6a8c', '#f4f7ff', '#8493b5', '#3e4a68'], 1.6, 0.9), 0.55);

    // Moonlight.
    const sun = ctx.createRadialGradient(-1.2, -1.6, 0, -1.2, -1.6, E * 1.4);
    sun.addColorStop(0, 'rgba(240,245,255,0.22)');
    sun.addColorStop(1, 'rgba(20,30,70,0.16)');
    ctx.fillStyle = sun;
    ctx.fillRect(-E, -E, 2 * E, 2 * E);

    // Finger strokes: each pass draws all grooves so walls overlap naturally.
    const strokes = GRID_SEGMENTS.map((s, i) => wobbly(noise, s[0], s[1], s[2], s[3], i * 1.37 + 0.5));
    const passes = [
      { dx: 0, dy: 0, w: 0.16, c: 'rgba(70,88,130,0.30)', blur: 0.035 },
      { dx: -0.018, dy: -0.022, w: 0.075, c: 'rgba(34,46,84,0.55)', blur: 0.012 },
      { dx: 0.014, dy: 0.016, w: 0.05, c: 'rgba(170,184,214,0.6)', blur: 0.008 },
      { dx: -0.082, dy: -0.088, w: 0.03, c: 'rgba(244,248,255,0.38)', blur: 0.016 },
      { dx: 0.078, dy: 0.082, w: 0.03, c: 'rgba(232,238,255,0.22)', blur: 0.016 },
    ];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of passes) {
      ctx.save();
      ctx.shadowColor = p.c;
      ctx.shadowBlur = p.blur * k;
      ctx.strokeStyle = p.c;
      ctx.lineWidth = p.w;
      for (const pts of strokes) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + p.dx, y + p.dy) : ctx.moveTo(x + p.dx, y + p.dy)));
        ctx.stroke();
      }
      ctx.restore();
    }

    // A few tiny shells far from the play area (only when the painted area reaches that far).
    for (let i = 0; i < (E > 3 ? 7 : 0); i++) {
      let x;
      let y;
      do {
        x = (rng() * 2 - 1) * (E - 0.3);
        y = (rng() * 2 - 1) * (E - 0.3);
      } while (Math.abs(x) < 2.5 && Math.abs(y) < 2.8);
      const r = 0.05 + rng() * 0.05;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * TAU);
      ctx.fillStyle = 'rgba(20,28,60,0.35)';
      ctx.beginPath();
      ctx.ellipse(0.012, 0.016, r, r * 0.8, 0, 0, TAU);
      ctx.fill();
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
      g.addColorStop(0, '#fbfcff');
      g.addColorStop(1, '#b7c2dc');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.8);
      ctx.arc(0, 0, r, Math.PI * 0.75, Math.PI * 2.25);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,105,145,0.5)';
      ctx.lineWidth = 0.006;
      for (let j = -3; j <= 3; j++) {
        ctx.beginPath();
        ctx.moveTo(0, r * 0.75);
        ctx.lineTo(Math.sin(j * 0.33) * r, -Math.cos(j * 0.33) * r * 0.95);
        ctx.stroke();
      }
      ctx.restore();
    }
    fadeToNight(ctx, E);
  },
};

// ───────────────────────────── 4. Chalk on hot asphalt ─────────────────────────────

function chalkLine(ctx, rng, x1, y1, x2, y2, color, w = 0.06) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const j = () => (rng() - 0.5) * 0.024;
  for (let pass = 0; pass < 8; pass++) {
    ctx.globalAlpha = 0.15 + rng() * 0.16;
    ctx.lineWidth = w * (0.55 + rng() * 0.6);
    ctx.setLineDash([0.04 + rng() * 0.35, 0.004 + rng() * 0.03]);
    ctx.lineDashOffset = rng();
    ctx.beginPath();
    ctx.moveTo(x1 + j(), y1 + j());
    ctx.quadraticCurveTo((x1 + x2) / 2 + j() * 1.6, (y1 + y2) / 2 + j() * 1.6, x2 + j(), y2 + j());
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  ctx.fillStyle = color;
  for (let i = 0; i < len * 70; i++) {
    const t = rng();
    const off = (rng() + rng() + rng() - 1.5) * 0.06;
    ctx.globalAlpha = 0.1 + rng() * 0.25;
    const s = 0.004 + rng() * 0.008;
    ctx.fillRect(x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off, s, s);
  }
  ctx.globalAlpha = 1;
}

const chalk = {
  id: 'chalk',
  name: 'طباشير على إسفلت',
  surface: 'asphalt',
  seed: 53,
  slab: null,
  highlight: [255, 255, 255],
  win: [255, 230, 110],
  particles: ['#ffffff', '#f4f0e6', '#ffe680'],
  ui: { accent: '#f6e3ae', accent2: '#9fb6e8', glow: 'rgba(246,227,174,0.45)' },

  backdrop(ctx, w, h) {
    radialBackdrop(ctx, w, h, [[0, '#2c2f38'], [0.6, '#181a21'], [1, '#0a0b10']]);
  },

  paintWorld(ctx, { E, noise, rng, q }) {
    const base = hex('#34373f');
    const dark = hex('#181a20');
    const field = pixelField(res(560, q), res(560, q), (u, v, o) => {
      const x = (u - 0.5) * 2 * E;
      const y = (v - 0.5) * 2 * E;
      mixRGB(base, dark, noise.fbm(x * 0.45, y * 0.45, 4) * 0.85, o);
      const s = 0.88 + noise.noise(x * 16, y * 16) * 0.24;
      o[0] *= s * 0.98;
      o[1] *= s;
      o[2] *= s * 1.05;
    });
    ctx.drawImage(field, -E, -E, 2 * E, 2 * E);

    // Aggregate stones in the asphalt.
    const colors = [['#6d7280', 0.5], ['#8a8f9c', 0.35], ['#0f1014', 0.6], ['#4f535e', 0.5], ['#a6abb8', 0.2]];
    const count = Math.floor(E * E * 900);
    for (let i = 0; i < count; i++) {
      const [c, a] = colors[Math.floor(rng() * colors.length)];
      ctx.globalAlpha = a * (0.5 + rng() * 0.5);
      ctx.fillStyle = c;
      const s = 0.006 + rng() * 0.016;
      ctx.fillRect((rng() * 2 - 1) * E, (rng() * 2 - 1) * E, s, s * (0.6 + rng() * 0.6));
    }
    ctx.globalAlpha = 1;

    // Cracks.
    for (let c = 0; c < 6; c++) {
      let x = (rng() * 2 - 1) * E;
      let y = (rng() * 2 - 1) * E;
      let a = rng() * TAU;
      const pts = [[x, y]];
      for (let i = 0; i < 40; i++) {
        a += (rng() - 0.5) * 0.9;
        x += Math.cos(a) * 0.06;
        y += Math.sin(a) * 0.06;
        pts.push([x, y]);
      }
      for (const [col, w, d] of [['rgba(140,146,160,0.2)', 0.014, 0.008], ['rgba(10,10,10,0.75)', 0.012, 0]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + d, py + d) : ctx.moveTo(px + d, py + d)));
        ctx.stroke();
      }
    }

    // A cold pool of street light.
    const heat = ctx.createRadialGradient(-1.4, -2.2, 0, -1.4, -2.2, E * 1.6);
    heat.addColorStop(0, 'rgba(200,215,255,0.10)');
    heat.addColorStop(0.5, 'rgba(120,140,200,0.04)');
    heat.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = heat;
    ctx.fillRect(-E, -E, 2 * E, 2 * E);

    // Chalk drawing on its own layer, later eroded by the asphalt's pores so it reads as real chalk.
    const layer = makeCanvas(ctx.canvas.width, ctx.canvas.height);
    const lc = layer.getContext('2d');
    lc.setTransform(ctx.getTransform());
    const crng = mulberry32(77);
    for (const [x1, y1, x2, y2] of GRID_SEGMENTS) chalkLine(lc, crng, x1, y1, x2, y2, '#f8f6ef', 0.07);
    const F = 1.72;
    for (const [x1, y1, x2, y2] of [[-F, -F, F, -F], [F, -F, F, F], [F, F, -F, F], [-F, F, -F, -F]]) {
      chalkLine(lc, crng, x1, y1, x2, y2, '#f6e3ae', 0.045);
    }

    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'destination-out';
    lc.globalAlpha = 0.85;
    lc.fillStyle = lc.createPattern(grainTile(96, 13, ['#000'], 2.4, 1.2), 'repeat');
    lc.fillRect(0, 0, layer.width, layer.height);
    pixelSpace(ctx, () => ctx.drawImage(layer, 0, 0));
    fadeToNight(ctx, E);
  },
};

// ───────────────────────────── 5. Luxurious night neon ─────────────────────────────

function neonStroke(ctx, pathFn, color, w, k) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [mult, alpha, blur] of [[8, 0.05, 0.3], [4.5, 0.1, 0.14], [2.2, 0.26, 0.05], [1.1, 0.9, 0.02]]) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = w * mult;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * k;
    pathFn();
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = w * 0.42;
  pathFn();
  ctx.stroke();
  ctx.restore();
}

const neon = {
  id: 'neon',
  name: 'ليلي فخم بالنيون',
  surface: 'glass',
  seed: 71,
  slab: { half: 1.8, radius: 0.18, thickness: 0.2 },
  edge: { top: '#1d2150', bottom: '#04050d', line: '#ff3df5', glow: '#ff3df5' },
  highlight: [41, 243, 255],
  win: [255, 61, 245],
  additive: true,
  particles: ['#29f3ff', '#ff3df5', '#ffffff'],
  ui: { accent: '#29f3ff', accent2: '#ff3df5', glow: 'rgba(41,243,255,0.5)' },

  backdrop(ctx, w, h) {
    radialBackdrop(ctx, w, h, [[0, '#24124f'], [0.55, '#0e0727'], [1, '#020107']]);
    const rng = mulberry32(5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 22; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = (0.03 + rng() * 0.08) * Math.max(w, h);
      const c = ['255,61,245', '41,243,255', '123,92,255'][i % 3];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c},${0.05 + rng() * 0.07})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  },

  paintWorld(ctx, { E, k }) {
    ctx.fillStyle = '#0a0720';
    ctx.fillRect(-E, -E, 2 * E, 2 * E);
    // Synthwave floor grid.
    ctx.strokeStyle = 'rgba(255,61,245,0.13)';
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    for (let v = -E; v <= E; v += 0.6) {
      ctx.moveTo(-E, v);
      ctx.lineTo(E, v);
      ctx.moveTo(v, -E);
      ctx.lineTo(v, E);
    }
    ctx.stroke();

    const slab = this.slab;
    const H = slab.half;
    slabShadow(ctx, slab, k, 'rgba(255,61,245,0.55)');
    slabShadow(ctx, slab, k, 'rgba(0,0,0,0.8)');
    ctx.save();
    slabClip(ctx, slab);
    const g = ctx.createLinearGradient(-H, -H, H, H);
    g.addColorStop(0, '#171c46');
    g.addColorStop(0.5, '#0b0e27');
    g.addColorStop(1, '#05060f');
    ctx.fillStyle = g;
    ctx.fillRect(-H, -H, 2 * H, 2 * H);
    // Glass reflections.
    ctx.globalCompositeOperation = 'lighter';
    const r1 = ctx.createLinearGradient(-H, -H * 0.2, -H * 0.2, -H);
    r1.addColorStop(0, 'rgba(255,255,255,0)');
    r1.addColorStop(0.5, 'rgba(160,190,255,0.08)');
    r1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r1;
    ctx.fillRect(-H, -H, 2 * H, 2 * H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    neonStroke(ctx, () => roundRectPath(ctx, -1.68, -1.68, 3.36, 3.36, 0.12), '#ff3df5', 0.026, k);
    neonStroke(ctx, () => gridPath(ctx), '#29f3ff', 0.036, k);
    bevel(ctx, slab, 'rgba(140,170,255,0.5)', 'rgba(0,0,0,0.6)', 0.04);
  },

  /** Animated neon breathing + occasional flicker, drawn in screen space. */
  overlay(ctx, renderer, time) {
    const cam = renderer.camera;
    const flicker = Math.sin(time * 37) > 0.97 ? 0.5 : 1;
    const a = (0.12 + 0.08 * Math.sin(time * 2.1)) * flicker;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(41,243,255,${a})`;
    const s = cam.project(0, 0).s;
    ctx.lineWidth = 0.12 * s;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of GRID_SEGMENTS) {
      const p = cam.project(x1, y1);
      const q = cam.project(x2, y2);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();
  },
};

export const THEMES = { wood, marble, sand, chalk, neon };
export const THEME_ORDER = ['marble', 'wood', 'neon', 'sand', 'chalk'];

/**
 * Paints the theme's world texture into a new canvas of `size` px covering
 * world [-E, E]². Results are cached because procedural textures are costly.
 */
const cache = new Map();
export function paintWorldTexture(theme, E, size) {
  const key = `${theme.id}:${E}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const k = size / (2 * E);
  ctx.setTransform(k, 0, 0, k, size / 2, size / 2);
  const q = Math.min(1, size / 1300);
  theme.paintWorld(ctx, { E, k, q, noise: new ValueNoise(theme.seed), rng: mulberry32(theme.seed * 7 + 1) });
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  return c;
}

/** Small flat preview of the board for the menu. */
export function themePreview(themeId, size = 200) {
  const theme = THEMES[themeId];
  const E = 2.05;
  const tex = paintWorldTexture(theme, E, Math.round(size * 1.5));
  const c = makeCanvas(size, size);
  c.getContext('2d').drawImage(tex, 0, 0, size, size);
  return c;
}
