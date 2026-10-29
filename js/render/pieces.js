/**
 * Realistic piece sprites painted procedurally on canvas (gradients, speckles,
 * fibres, crimps…). Every piece gets its own seed so the three pieces of a
 * player look naturally different, like real pebbles or pits would.
 *
 * Painters work in normalized coordinates: the piece fits in radius ≈ 1,
 * light comes from the top-left (screen space).
 */
import { makeCanvas, smoothClosedPath, roundRectPath } from './texture.js';
import { mulberry32 } from '../core/rng.js';

const TAU = Math.PI * 2;
const LIGHT = { x: -0.6, y: -0.8 };
const SPAN = 1.18; // sprite canvas covers [-SPAN, SPAN]

/** Light direction expressed in a frame rotated by `a`. */
function localLight(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: LIGHT.x * c + LIGHT.y * s, y: -LIGHT.x * s + LIGHT.y * c };
}

/** Cylinder shading across local y for a body lying along local x. */
function cylinderShade(ctx, a, R, x0, x1, strength = 1) {
  const L = localLight(a);
  const litTop = L.y < 0;
  const g = ctx.createLinearGradient(0, litTop ? -R : R, 0, litTop ? R : -R);
  g.addColorStop(0, `rgba(0,0,0,${0.18 * strength})`);
  g.addColorStop(0.16, `rgba(255,255,255,${0.5 * strength})`);
  g.addColorStop(0.4, `rgba(255,255,255,${0.06 * strength})`);
  g.addColorStop(0.75, `rgba(0,0,0,${0.16 * strength})`);
  g.addColorStop(1, `rgba(0,0,0,${0.5 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(x0, -R * 1.2, x1 - x0, R * 2.4);
}

// ───────────────────────────── stones ─────────────────────────────

function paintStone(ctx, team, rng) {
  const pal = team === 0
    ? { hi: '#fffdf6', base: '#ddd4c1', lo: '#8c826d', side: '#5f5746', speck: ['#9b917c', '#f3eee4', '#b8ad97', '#c9a98a'] }
    : { hi: '#a3aab3', base: '#555b63', lo: '#1f2328', side: '#121417', speck: ['#262a2f', '#9aa1a9', '#3b4148', '#6d747c'] };
  const n = 20;
  const p1 = rng() * TAU;
  const p2 = rng() * TAU;
  const aspect = 0.8 + rng() * 0.17;
  const rot = rng() * Math.PI;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = 0.9 + 0.07 * Math.sin(a * 2 + p1) + 0.05 * Math.sin(a * 3 + p2) + (rng() - 0.5) * 0.04;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * aspect;
    pts.push([x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  // Visible lower side (thickness).
  ctx.save();
  ctx.translate(0, 0.17);
  smoothClosedPath(ctx, pts);
  ctx.fillStyle = pal.side;
  ctx.fill();
  ctx.restore();
  // Top surface.
  smoothClosedPath(ctx, pts);
  const g = ctx.createRadialGradient(-0.35, -0.45, 0.05, 0, 0, 1.25);
  g.addColorStop(0, pal.hi);
  g.addColorStop(0.45, pal.base);
  g.addColorStop(1, pal.lo);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 190; i++) {
    ctx.globalAlpha = 0.2 + rng() * 0.45;
    ctx.fillStyle = pal.speck[Math.floor(rng() * pal.speck.length)];
    ctx.beginPath();
    ctx.arc(rng() * 2 - 1, rng() * 2 - 1, 0.008 + rng() * 0.03, 0, TAU);
    ctx.fill();
  }
  // A faint mineral vein.
  ctx.globalAlpha = team === 0 ? 0.35 : 0.22;
  ctx.strokeStyle = team === 0 ? '#ffffff' : '#8a929c';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  const va = rng() * TAU;
  ctx.moveTo(Math.cos(va) * 1.2, Math.sin(va) * 1.2);
  ctx.quadraticCurveTo(rng() * 0.6 - 0.3, rng() * 0.6 - 0.3, -Math.cos(va) * 1.2, -Math.sin(va) * 1.2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Rim darkening away from the light, then a soft specular highlight.
  const rim = ctx.createRadialGradient(-0.25, -0.32, 0.5, -0.1, -0.12, 1.35);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = rim;
  ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
  const sp = ctx.createRadialGradient(-0.38, -0.46, 0, -0.38, -0.46, 0.42);
  sp.addColorStop(0, `rgba(255,255,255,${team === 0 ? 0.65 : 0.4})`);
  sp.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sp;
  ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
  ctx.restore();
}

// ───────────────────────────── cigarette butts ─────────────────────────────

function paintButt(ctx, team, rng) {
  const a = rng() * TAU;
  ctx.rotate(a);
  const R = 0.27;
  const fx0 = -1.0;
  const fx1 = 0.06;
  const px1 = 0.74;
  // Filter.
  ctx.save();
  roundRectPath(ctx, fx0, -R, fx1 - fx0, 2 * R, 0.07);
  ctx.fillStyle = team === 0 ? '#d98a3d' : '#f4f2ec';
  ctx.fill();
  ctx.clip();
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = team === 0 ? (rng() < 0.7 ? '#a65d20' : '#f0b26a') : '#d4cfc4';
    ctx.globalAlpha = 0.25 + rng() * 0.5;
    ctx.fillRect(fx0 + rng() * (fx1 - fx0), -R + rng() * 2 * R, 0.012 + rng() * 0.02, 0.01 + rng() * 0.012);
  }
  ctx.globalAlpha = 1;
  cylinderShade(ctx, a, R, fx0, fx1);
  ctx.restore();
  // Paper part, slightly crushed towards the burnt end.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fx1, -R);
  ctx.lineTo(px1 - 0.04, -R * 0.9);
  ctx.quadraticCurveTo(px1 + 0.05, -R * 0.5, px1 + 0.02, 0);
  ctx.quadraticCurveTo(px1 + 0.06, R * 0.55, px1 - 0.03, R * 0.92);
  ctx.lineTo(fx1, R);
  ctx.closePath();
  ctx.fillStyle = '#f7f5ef';
  ctx.fill();
  ctx.clip();
  const burn = ctx.createLinearGradient(px1 - 0.22, 0, px1 + 0.05, 0);
  burn.addColorStop(0, 'rgba(210,170,110,0)');
  burn.addColorStop(0.6, 'rgba(190,140,80,0.6)');
  burn.addColorStop(1, 'rgba(90,60,30,0.95)');
  ctx.fillStyle = burn;
  ctx.fillRect(fx1, -R, px1 + 0.1 - fx1, 2 * R);
  // Crumple wrinkles.
  ctx.strokeStyle = 'rgba(120,110,100,0.35)';
  ctx.lineWidth = 0.012;
  for (let i = 0; i < 6; i++) {
    const x = fx1 + 0.1 + rng() * (px1 - fx1 - 0.15);
    ctx.beginPath();
    ctx.moveTo(x, -R);
    ctx.quadraticCurveTo(x + (rng() - 0.5) * 0.12, 0, x + (rng() - 0.5) * 0.08, R);
    ctx.stroke();
  }
  cylinderShade(ctx, a, R, fx1, px1 + 0.1, 0.9);
  ctx.restore();
  // Ash tip with a ragged edge.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(px1 - 0.03, -R * 0.88);
  const teeth = 7;
  for (let i = 0; i <= teeth; i++) {
    const y = -R * 0.88 + (i / teeth) * R * 1.76;
    const x = px1 + 0.13 + (rng() - 0.5) * 0.08 - Math.abs(y) * 0.25;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(px1 - 0.03, R * 0.9);
  ctx.quadraticCurveTo(px1 + 0.06, R * 0.55, px1 + 0.02, 0);
  ctx.quadraticCurveTo(px1 + 0.05, -R * 0.5, px1 - 0.03, -R * 0.88);
  ctx.closePath();
  const ash = ctx.createLinearGradient(px1, 0, px1 + 0.16, 0);
  ash.addColorStop(0, '#3a3633');
  ash.addColorStop(1, '#6e6a65');
  ctx.fillStyle = ash;
  ctx.fill();
  ctx.clip();
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = rng() < 0.5 ? '#9a958e' : '#1e1c1a';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(px1 + rng() * 0.15, -R + rng() * 2 * R, 0.015, 0.015);
  }
  ctx.globalAlpha = 1;
  cylinderShade(ctx, a, R, px1 - 0.05, px1 + 0.2, 0.7);
  ctx.restore();
  // Tipping band and filter mouth.
  ctx.fillStyle = team === 0 ? '#e9c862' : '#c8ccd2';
  ctx.fillRect(fx1 - 0.035, -R, 0.035, 2 * R);
  ctx.strokeStyle = team === 0 ? 'rgba(140,90,20,0.6)' : 'rgba(120,125,135,0.6)';
  ctx.lineWidth = 0.008;
  ctx.strokeRect(fx1 - 0.035, -R, 0.035, 2 * R);
  ctx.beginPath();
  ctx.ellipse(fx0 + 0.02, 0, 0.06, R * 0.95, 0, 0, TAU);
  ctx.fillStyle = team === 0 ? '#e9a35a' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.012;
  ctx.stroke();
}

// ───────────────────────────── wooden sticks ─────────────────────────────

function drawStick(ctx, team, rng, a, len, R, oy) {
  const pal = team === 0
    ? { base: '#cfa468', dark: '#7c5a2c', end: '#ecd3a0', ring: 'rgba(150,105,50,0.55)' }
    : { base: '#7a4126', dark: '#341709', end: '#c08a5c', ring: 'rgba(80,35,10,0.6)' };
  ctx.save();
  ctx.rotate(a);
  ctx.translate(0, oy);
  ctx.beginPath();
  ctx.moveTo(-len, -R * 0.8);
  // Broken, splintered end on the left.
  for (let i = 0; i <= 5; i++) {
    const y = -R * 0.8 + (i / 5) * R * 1.6;
    ctx.lineTo(-len - 0.03 - rng() * 0.07, y);
  }
  ctx.lineTo(-len, R);
  ctx.lineTo(len, R * 0.96);
  ctx.ellipse(len, 0, 0.05, R * 0.96, 0, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(-len, -R);
  ctx.closePath();
  ctx.fillStyle = pal.base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Bark streaks.
  for (let i = 0; i < 22; i++) {
    const y = (rng() * 2 - 1) * R;
    const x0 = -len + rng() * len;
    ctx.strokeStyle = pal.dark;
    ctx.globalAlpha = 0.18 + rng() * 0.35;
    ctx.lineWidth = 0.006 + rng() * 0.012;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + 0.3 + rng() * 0.9, y + (rng() - 0.5) * 0.03);
    ctx.stroke();
  }
  // A knot.
  const kx = (rng() - 0.5) * len;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = pal.dark;
  ctx.beginPath();
  ctx.ellipse(kx, (rng() - 0.5) * R * 0.6, 0.06, 0.035, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  cylinderShade(ctx, a, R, -len - 0.15, len + 0.1);
  ctx.restore();
  // Clean cut end showing growth rings.
  ctx.beginPath();
  ctx.ellipse(len, 0, 0.05, R * 0.96, 0, 0, TAU);
  ctx.fillStyle = pal.end;
  ctx.fill();
  ctx.strokeStyle = pal.ring;
  ctx.lineWidth = 0.008;
  for (const f of [0.35, 0.65]) {
    ctx.beginPath();
    ctx.ellipse(len, 0, 0.05 * f, R * 0.96 * f, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function paintSticks(ctx, team, rng) {
  const a0 = rng() * Math.PI;
  const a1 = a0 + 0.95 + rng() * 0.5;
  const r0 = 0.12 + rng() * 0.025;
  const r1 = 0.12 + rng() * 0.025;
  drawStick(ctx, team, rng, a0, 0.92, r0, 0);
  // Contact shadow of the upper stick onto the lower one.
  ctx.save();
  ctx.rotate(a1);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0.05, 0.08, 0.95, r1 * 1.2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawStick(ctx, team, rng, a1, 0.95, r1, -0.04);
}

// ───────────────────────────── bottle caps ─────────────────────────────

function paintCap(ctx, team, rng) {
  const pal = team === 0
    ? { paint: '#d8a832', hi: '#fff0b0', lo: '#6e4c0c', side: '#4a3206', print: '#7c1d1d', printHi: '#b13434' }
    : { paint: '#c8232c', hi: '#ff9a9a', lo: '#5a0a0f', side: '#3a0508', print: '#f6f1e6', printHi: '#ffffff' };
  const rot = rng() * TAU;
  const teeth = 21;
  const crimp = (scale = 1) => {
    ctx.beginPath();
    for (let i = 0; i <= 210; i++) {
      const t = (i / 210) * TAU;
      const r = (1 + 0.045 * Math.cos(teeth * (t + rot))) * scale;
      const x = Math.cos(t) * r;
      const y = Math.sin(t) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  // Side wall.
  ctx.save();
  ctx.translate(0, 0.2);
  crimp();
  ctx.fillStyle = pal.side;
  ctx.fill();
  ctx.restore();
  // Fluted skirt.
  crimp();
  ctx.fillStyle = pal.paint;
  ctx.fill();
  const la = Math.atan2(LIGHT.y, LIGHT.x);
  for (let i = 0; i < teeth; i++) {
    const t0 = rot + (i / teeth) * TAU - Math.PI / teeth;
    const t1 = t0 + TAU / teeth;
    const mid = (t0 + t1) / 2;
    const facing = Math.cos(mid - la);
    for (const [s0, s1, k] of [[t0, mid, 1], [mid, t1, -1]]) {
      const lit = 0.5 + 0.5 * facing * 0.9 + k * 0.12;
      ctx.beginPath();
      ctx.moveTo(Math.cos(s0) * 0.8, Math.sin(s0) * 0.8);
      ctx.lineTo(Math.cos(s0) * 1.06, Math.sin(s0) * 1.06);
      ctx.lineTo(Math.cos(s1) * 1.06, Math.sin(s1) * 1.06);
      ctx.lineTo(Math.cos(s1) * 0.8, Math.sin(s1) * 0.8);
      ctx.closePath();
      ctx.fillStyle = lit > 0.5 ? `rgba(255,255,255,${(lit - 0.5) * 0.7})` : `rgba(0,0,0,${(0.5 - lit) * 0.9})`;
      ctx.save();
      crimp();
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(Math.cos(s0) * 0.8, Math.sin(s0) * 0.8);
      ctx.lineTo(Math.cos(s0) * 1.06, Math.sin(s0) * 1.06);
      ctx.lineTo(Math.cos(s1) * 1.06, Math.sin(s1) * 1.06);
      ctx.lineTo(Math.cos(s1) * 0.8, Math.sin(s1) * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  // Top face.
  ctx.beginPath();
  ctx.arc(0, 0, 0.8, 0, TAU);
  const g = ctx.createRadialGradient(-0.3, -0.36, 0.05, 0, 0, 0.95);
  g.addColorStop(0, pal.hi);
  g.addColorStop(0.5, pal.paint);
  g.addColorStop(1, pal.lo);
  ctx.fillStyle = g;
  ctx.fill();
  // Printed ring and star.
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = pal.print;
  ctx.beginPath();
  ctx.arc(0, 0, 0.6, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.4 : 0.17;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = pal.print;
  ctx.fill();
  // Bevelled rim.
  const rim = ctx.createLinearGradient(-0.8, -0.8, 0.8, 0.8);
  rim.addColorStop(0, 'rgba(255,255,255,0.75)');
  rim.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  rim.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 0.79, 0, TAU);
  ctx.stroke();
  // Scratches + specular.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.008;
  for (let i = 0; i < 5; i++) {
    const x = (rng() - 0.5) * 1.1;
    const y = (rng() - 0.5) * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 0.4, y + (rng() - 0.5) * 0.2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(-0.32, -0.38);
  ctx.rotate(-0.7);
  const sp = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.32);
  sp.addColorStop(0, 'rgba(255,255,255,0.7)');
  sp.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.scale(1, 0.45);
  ctx.fillStyle = sp;
  ctx.beginPath();
  ctx.arc(0, 0, 0.32, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ───────────────────────────── olive pits ─────────────────────────────

function paintPit(ctx, team, rng) {
  const pal = team === 0
    ? { base: '#cfae84', hi: '#f3e2c4', lo: '#7c5c3a', side: '#5a4128', groove: 'rgba(95,62,30,0.55)', ridge: 'rgba(255,240,215,0.35)' }
    : { base: '#5b3a33', hi: '#a07468', lo: '#22110e', side: '#170907', groove: 'rgba(12,4,2,0.6)', ridge: 'rgba(220,170,150,0.25)' };
  const a = rng() * Math.PI;
  const blunt = 0.85 + rng() * 0.25;
  const W = 0.6;
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.bezierCurveTo(-0.62, -W * 1.05, 0.55, -W * blunt, 0.98, 0);
    ctx.bezierCurveTo(0.55, W * blunt, -0.62, W * 1.05, -1, 0);
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(0, 0.15);
  ctx.rotate(a);
  shape();
  ctx.fillStyle = pal.side;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.rotate(a);
  const L = localLight(a);
  shape();
  const g = ctx.createRadialGradient(L.x * 0.45, L.y * 0.3, 0.04, 0, 0, 1.05);
  g.addColorStop(0, pal.hi);
  g.addColorStop(0.5, pal.base);
  g.addColorStop(1, pal.lo);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // Longitudinal ridges and grooves.
  for (const kk of [-0.75, -0.42, -0.1, 0.22, 0.52, 0.8]) {
    const y = kk * W * 1.25;
    ctx.strokeStyle = pal.groove;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.98, 0);
    ctx.bezierCurveTo(-0.5, y, 0.5, y, 0.97, 0);
    ctx.stroke();
    ctx.strokeStyle = pal.ridge;
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(-0.95, 0);
    ctx.bezierCurveTo(-0.5, y + 0.05, 0.5, y + 0.05, 0.94, 0);
    ctx.stroke();
  }
  // Pitted texture.
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = pal.groove;
    ctx.globalAlpha = 0.3 + rng() * 0.4;
    ctx.beginPath();
    ctx.ellipse(rng() * 1.8 - 0.9, (rng() * 2 - 1) * W * 0.8, 0.03 + rng() * 0.03, 0.012, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const sp = ctx.createRadialGradient(L.x * 0.4, L.y * 0.28, 0, L.x * 0.4, L.y * 0.28, 0.45);
  sp.addColorStop(0, 'rgba(255,255,255,0.45)');
  sp.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sp;
  ctx.fillRect(-1.1, -1, 2.2, 2);
  ctx.restore();
}

// ───────────────────────────── registry ─────────────────────────────

/** `size` = world diameter of the piece (a cell is 1). */
export const PIECES = {
  stone: { id: 'stone', name: 'حجارة صغيرة', size: 0.62, paint: paintStone },
  butt: { id: 'butt', name: 'أعقاب سجائر', size: 0.8, paint: paintButt },
  stick: { id: 'stick', name: 'عيدان خشب', size: 0.84, paint: paintSticks },
  cap: { id: 'cap', name: 'أغطية زجاجات', size: 0.62, paint: paintCap },
  pit: { id: 'pit', name: 'نوى زيتون', size: 0.66, paint: paintPit },
};
export const PIECE_ORDER = ['stone', 'butt', 'stick', 'cap', 'pit'];

/** The computer always uses a different, well-contrasting piece. */
export const OPPONENT_PIECE = { stone: 'cap', butt: 'pit', stick: 'stone', cap: 'stone', pit: 'butt' };

export const SPRITE_SPAN = SPAN;

/** Paints a sprite (and its blurred silhouette for shadows). */
export function makeSprite(type, team, seed, px) {
  px = Math.max(24, Math.min(360, Math.round(px)));
  const c = makeCanvas(px, px);
  const ctx = c.getContext('2d');
  ctx.translate(px / 2, px / 2);
  ctx.scale(px / (2 * SPAN), px / (2 * SPAN));
  PIECES[type].paint(ctx, team, mulberry32(seed));

  const shadow = makeCanvas(px, px);
  const sctx = shadow.getContext('2d');
  sctx.shadowColor = 'rgba(0,0,0,1)';
  sctx.shadowBlur = px * 0.05;
  sctx.shadowOffsetX = px * 4;
  sctx.drawImage(c, -px * 4, 0);
  return { canvas: c, shadow };
}

/** Preview image for menus. */
export function piecePreview(type, team, size = 96, seed = 3) {
  return makeSprite(type, team, seed, size).canvas;
}
