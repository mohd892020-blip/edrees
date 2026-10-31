/**
 * Canvas scene renderer: perspective board, pieces with shadows, animations,
 * highlights, particles and hit-testing. It knows nothing about the rules —
 * the UI layer tells it what to show and which pieces/cells are interactive.
 */
import { Camera } from './camera.js';
import { THEMES, paintWorldTexture } from './themes.js';
import { PIECES, makeSprite, SPRITE_SPAN } from './pieces.js';
import { makeCanvas, roundRectPoints } from './texture.js';

const TAU = Math.PI * 2;
const WORLD_E = 3.6; // half-size of the painted world texture
const PIECE_H = 0.07; // height of a piece's visual centre above the board
const GRAVITY = 7;

export const Ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};

const lerp = (a, b, t) => a + (b - a) * t;
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
export const cellCenter = (cell) => ({ x: (cell % 3) - 1, y: Math.floor(cell / 3) - 1 });

export class Renderer {
  constructor(canvas, { onImpact = null, onLift = null, getInsets = null, webgl = false } = {}) {
    this.canvas = canvas;
    this.getInsets = getInsets;
    this.ctx = webgl ? null : canvas.getContext('2d'); // the 3D world subclass brings its own context
    this.camera = new Camera({ tiltDeg: 30, distance: 9 });
    this.static = makeCanvas(1, 1);
    this.theme = THEMES.wood;
    this.pieceTypes = ['stone', 'cap'];
    this.onImpact = onImpact;
    this.onLift = onLift;

    this.pieces = [];
    this.tweens = [];
    this.particles = [];
    this.rings = [];
    this.confetti = [];
    this.sprites = new Map();

    this.interactiveCells = [];
    this.interactivePieces = [];
    this.hoverCell = null;
    this.ghost = null;
    this.selected = null;
    this.drag = null;
    this.win = null;
    this.thinking = null;
    this.dangerCells = [];
    this.blockedCells = [];
    this.forbiddenCells = []; // placements that would complete a line
    this.hint = null; // { pieceId, to } suggested move

    this.time = 0;
    this.running = false;
    this.dpr = 1;
    this.orientation = 'portrait';
    this.seed = 1;

    this._cellOutlines = Array.from({ length: 9 }, (_, i) => {
      const { x, y } = cellCenter(i);
      return roundRectPoints(x - 0.43, y - 0.43, x + 0.43, y + 0.43, 0.12, 5);
    });

    this.resetPieces(1);
    this._resizeObserver = new ResizeObserver(() => this._scheduleResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._loop = this._loop.bind(this);
  }

  // ───────────────────────── lifecycle ─────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  _scheduleResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.resize(), 60);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    if (!cw || !ch) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cw * this.dpr);
    const h = Math.round(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this._layout();
    // The cached board image depends on the camera, which also moves when the HUD changes height.
    const cam = this.camera;
    const key = `${this.theme.id}:${w}x${h}:${cam.f.toFixed(3)}:${cam.cx.toFixed(2)}:${cam.cy.toFixed(2)}`;
    if (key !== this._staticKey) this._rebuild();
    this._snapTrayPieces();
  }

  _layout() {
    const { width: w, height: h } = this.canvas;
    this.orientation = w / h > 1.12 ? 'landscape' : 'portrait';
    const slab = this.theme.slab;
    const B = slab ? slab.half + 0.08 : 1.85;
    const t = slab ? slab.thickness : 0;
    const pts = [[-B, -B], [B, -B], [-B, B, -t - 0.05], [B, B, -t - 0.05]];
    if (this.orientation === 'portrait') {
      pts.push([-1.4, -2.85, 0.35], [1.4, -2.85, 0.35], [-1.4, 2.8], [1.4, 2.8]);
    } else {
      pts.push([-3.0, -1.4, 0.3], [3.0, -1.4, 0.3], [-3.0, 1.45], [3.0, 1.45]);
    }
    // Keep the board clear of the HUD overlays drawn above/below the canvas.
    const ins = this.getInsets ? this.getInsets() : { top: 0, bottom: 0 };
    const top = ins.top * this.dpr;
    const bottom = ins.bottom * this.dpr;
    const pad = Math.min(w, h) * 0.03;
    this.camera.fit(pts, { x: 0, y: top, width: w, height: Math.max(80, h - top - bottom) }, pad, pad);
    this.trays = this._traySlots();
  }

  _traySlots() {
    if (this.orientation === 'portrait') {
      return [
        [0.9, 0, -0.9].map((x) => ({ x, y: 2.36 })),
        [-0.9, 0, 0.9].map((x) => ({ x, y: -2.36 })),
      ];
    }
    return [
      [-0.9, 0, 0.9].map((y) => ({ x: 2.55, y })),
      [-0.9, 0, 0.9].map((y) => ({ x: -2.55, y })),
    ];
  }

  setTheme(id) {
    if (!THEMES[id] || this.theme.id === id) return;
    this.theme = THEMES[id];
    this._layout();
    this._rebuild();
    this._snapTrayPieces();
  }

  setPieceTypes(types) {
    this.pieceTypes = types.slice();
    for (const p of this.pieces) p.type = this.pieceTypes[p.owner];
    this._buildSprites();
  }

  _rebuild() {
    this._buildStatic();
    this._buildSprites();
  }

  // ───────────────────────── static layer ─────────────────────────

  _buildStatic() {
    const { width: w, height: h } = this.canvas;
    const st = this.static;
    st.width = w;
    st.height = h;
    const ctx = st.getContext('2d');
    this.theme.backdrop(ctx, w, h);

    const cam = this.camera;
    const E = WORLD_E;
    const sMax = cam.project(0, Math.min(E, 3)).s;
    const T = Math.max(640, Math.min(2048, Math.ceil((2 * E * sMax) / 64) * 64));
    const tex = this._feathered(paintWorldTexture(this.theme, E, T));

    // Perspective projection of the flat texture, one screen row at a time.
    const top = Math.max(0, Math.floor(cam.project(0, -E).y));
    const bottom = Math.min(h, Math.ceil(cam.project(0, E).y));
    ctx.imageSmoothingQuality = 'high';
    for (let row = top; row < bottom; row++) {
      const { y } = cam.unproject(w / 2, row + 0.5);
      if (y < -E || y > E) continue;
      const ty = Math.min(T - 1, Math.max(0, Math.floor(((y + E) / (2 * E)) * T)));
      const l = cam.project(-E, y);
      const r = cam.project(E, y);
      ctx.drawImage(tex, 0, ty, T, 1, l.x, row, r.x - l.x, 1.2);
    }
    if (this.theme.slab) this._drawSlabEdge(ctx);
    this._staticKey = `${this.theme.id}:${w}x${h}:${cam.f.toFixed(3)}:${cam.cx.toFixed(2)}:${cam.cy.toFixed(2)}`;
  }

  _feathered(tex) {
    if (tex.__feathered) return tex.__feathered;
    const T = tex.width;
    const c = makeCanvas(T, T);
    const ctx = c.getContext('2d');
    ctx.drawImage(tex, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createRadialGradient(T / 2, T / 2, T * 0.36, T / 2, T / 2, T * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, T, T);
    tex.__feathered = c;
    return c;
  }

  _drawSlabEdge(ctx) {
    const cam = this.camera;
    const { half: H, radius: r, thickness: t } = this.theme.slab;
    const e = this.theme.edge;
    const outline = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI - (i / 8) * (Math.PI / 2);
      outline.push([-H + r + Math.cos(a) * r, H - r + Math.sin(a) * r]);
    }
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 2 - (i / 8) * (Math.PI / 2);
      outline.push([H - r + Math.cos(a) * r, H - r + Math.sin(a) * r]);
    }
    const top = outline.map(([x, y]) => cam.project(x, y, 0));
    const bot = outline.map(([x, y]) => cam.project(x, y, -t));
    const path = () => {
      ctx.beginPath();
      top.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
      ctx.closePath();
    };
    const y0 = Math.min(...top.map((p) => p.y));
    const y1 = Math.max(...bot.map((p) => p.y));
    path();
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, e.top);
    g.addColorStop(1, e.bottom);
    ctx.fillStyle = g;
    ctx.fill();
    if (e.grain) {
      ctx.save();
      path();
      ctx.clip();
      ctx.strokeStyle = 'rgba(30,12,2,0.35)';
      ctx.lineWidth = Math.max(1, this.dpr * 0.8);
      for (let i = 0; i < 14; i++) {
        const yy = lerp(y0, y1, (i + 0.5) / 14);
        ctx.beginPath();
        ctx.moveTo(top[0].x, yy + Math.sin(i * 3.1) * 2);
        ctx.bezierCurveTo(top[5].x, yy - 3, top[12].x, yy + 3, top[top.length - 1].x, yy);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Ambient occlusion at the bottom, highlight on the top edge.
    ctx.save();
    ctx.lineWidth = 2 * this.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    bot.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    if (e.glow) {
      ctx.shadowColor = e.glow;
      ctx.shadowBlur = 14 * this.dpr;
      ctx.strokeStyle = e.glow;
      ctx.lineWidth = 2.2 * this.dpr;
      ctx.beginPath();
      bot.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y - 2 * this.dpr) : ctx.moveTo(p.x, p.y - 2 * this.dpr)));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (e.line) {
      ctx.strokeStyle = e.line;
      ctx.lineWidth = 1.6 * this.dpr;
      ctx.beginPath();
      top.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + this.dpr) : ctx.moveTo(p.x, p.y + this.dpr)));
      ctx.stroke();
    }
    ctx.restore();
  }

  // ───────────────────────── pieces ─────────────────────────

  /** Puts all six pieces back in their trays. `seed` varies their natural look. */
  resetPieces(seed = Math.floor(Math.random() * 1e6)) {
    this.seed = seed;
    // Piece animations end here; `keep` tweens (the camera glide) carry on.
    this.tweens.filter((tw) => !tw.keep).forEach((tw) => tw.resolve());
    this.tweens = this.tweens.filter((tw) => tw.keep);
    this.pieces = [];
    for (const owner of [0, 1]) {
      for (let idx = 0; idx < 3; idx++) {
        this.pieces.push({
          id: `p${owner}-${idx}`, owner, idx, type: this.pieceTypes[owner],
          seed: seed + owner * 101 + idx * 37, x: 0, y: 0, z: 0, cell: null,
          squash: 0, scale: 1, dragging: false,
        });
      }
    }
    this.selected = null;
    this.drag = null;
    this.win = null;
    this.ghost = null;
    this.hoverCell = null;
    this.particles = [];
    this.rings = [];
    this.confetti = [];
    this.thinking = null;
    this.dangerCells = [];
    this.forbiddenCells = [];
    this.hint = null;
    this.interactiveCells = [];
    this.interactivePieces = [];
    if (this.trays) this._snapTrayPieces(true);
    if (this._staticKey) this._buildSprites();
  }

  _snapTrayPieces(force = false) {
    if (!this.trays) return;
    for (const p of this.pieces) {
      if (p.cell !== null || p.dragging) continue;
      if (!force && this.tweens.some((tw) => tw.target === p)) continue;
      const slot = this.trays[p.owner][p.idx];
      p.x = slot.x;
      p.y = slot.y;
      if (p !== this.selected) p.z = 0;
    }
  }

  _buildSprites() {
    const s = this.camera.project(0, 2, 0.7).s;
    const keep = new Map();
    for (const p of this.pieces) {
      const def = PIECES[p.type];
      const px = Math.round(def.size * SPRITE_SPAN * s * 1.15);
      const key = `${p.type}:${p.owner}:${p.seed}:${px}`;
      keep.set(key, this.sprites.get(key) || makeSprite(p.type, p.owner, p.seed, px));
      p.spriteKey = key;
    }
    this.sprites = keep;
  }

  byId(id) {
    return this.pieces.find((p) => p.id === id) || null;
  }

  pieceAtCell(cell) {
    return this.pieces.find((p) => p.cell === cell) || null;
  }

  nextTrayPiece(owner) {
    return this.pieces.find((p) => p.owner === owner && p.cell === null) || null;
  }

  /** Lays pieces out to match a game state instantly (used on start / resync). */
  syncToState(state) {
    for (const p of this.pieces) p.cell = null;
    for (const owner of [0, 1]) {
      const cells = [];
      state.board.forEach((v, i) => v === owner && cells.push(i));
      const mine = this.pieces.filter((p) => p.owner === owner);
      cells.forEach((cell, i) => {
        const p = mine[i];
        p.cell = cell;
        const c = cellCenter(cell);
        p.x = c.x;
        p.y = c.y;
        p.z = 0;
      });
    }
    this._snapTrayPieces(true);
  }

  // ───────────────────────── tweens & animations ─────────────────────────

  _tween(duration, update, easing = Ease.inOutCubic, target = null) {
    if (target) {
      for (const tw of this.tweens.filter((t) => t.target === target && t.exclusive)) {
        tw.resolve();
        this.tweens.splice(this.tweens.indexOf(tw), 1);
      }
    }
    return new Promise((resolve) => {
      this.tweens.push({ t: 0, duration, update, easing, resolve, target, exclusive: !!target });
    });
  }

  _liftTo(p, z, dur = 0.18) {
    const z0 = p.z;
    return this._tween(dur, (e) => {
      p.z = lerp(z0, z, e);
    }, Ease.outCubic, p);
  }

  _flyTo(p, x1, y1, dur, zEnd = null) {
    const x0 = p.x;
    const y0 = p.y;
    const z0 = p.z;
    const ze = zEnd === null ? z0 : zEnd;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const arc = 0.15 + dist * 0.12;
    return this._tween(dur, (e) => {
      p.x = lerp(x0, x1, e);
      p.y = lerp(y0, y1, e);
      p.z = lerp(z0, ze, e) + arc * Math.sin(Math.PI * e);
    }, Ease.inOutCubic, p);
  }

  /** Fall to the board with an impact (sound/particles) and a small bounce. */
  _dropTo(p, x1, y1, { impact = true } = {}) {
    const x0 = p.x;
    const y0 = p.y;
    const z0 = Math.max(p.z, 0.04);
    const hit = 0.5;
    let impacted = false;
    const dur = 0.34 + Math.min(0.2, z0 * 0.25);
    return this._tween(dur, (_, t) => {
      const k = Math.min(1, t / hit);
      p.x = lerp(x0, x1, Ease.outCubic(k));
      p.y = lerp(y0, y1, Ease.outCubic(k));
      if (t < hit) {
        p.z = z0 * (1 - k * k);
      } else {
        if (!impacted) {
          impacted = true;
          if (impact) {
            p.squash = 1;
            if (this.onImpact) this.onImpact(p, Math.min(1, 0.45 + z0));
            this._burst(p);
          }
        }
        const b = (t - hit) / (1 - hit);
        p.z = (0.07 * z0 + 0.015) * Math.abs(Math.sin(b * Math.PI * 2)) * (1 - b);
      }
      if (t >= 1) {
        p.x = x1;
        p.y = y1;
        p.z = 0;
      }
    }, Ease.linear, p);
  }

  async animatePlace(owner, cell, { pieceId = null, fromDrag = false } = {}) {
    const p = (pieceId && this.byId(pieceId)) || this.nextTrayPiece(owner);
    if (!p) return;
    if (this.selected === p) this.selected = null;
    p.cell = cell;
    const c = cellCenter(cell);
    if (!fromDrag) {
      if (this.onLift) this.onLift(p);
      await this._liftTo(p, 0.45, 0.18);
      await this._flyTo(p, c.x, c.y, 0.45);
    }
    await this._dropTo(p, c.x, c.y);
  }

  async animateMove(from, to, { fromDrag = false } = {}) {
    const p = this.pieceAtCell(from);
    if (!p) return;
    if (this.selected === p) this.selected = null;
    p.cell = to;
    const c = cellCenter(to);
    if (!fromDrag) {
      if (p.z < 0.3) {
        if (this.onLift) this.onLift(p);
        await this._liftTo(p, 0.45, 0.2);
      }
      await this._flyTo(p, c.x, c.y, 0.48);
    }
    await this._dropTo(p, c.x, c.y);
  }

  // ───────────────────────── selection & drag ─────────────────────────

  select(p) {
    if (this.selected === p) return;
    const prev = this.selected;
    this.selected = p;
    if (prev && !prev.dragging) this._liftTo(prev, 0, 0.16);
    if (p) this._liftTo(p, 0.16, 0.16);
  }

  beginDrag(p, sx, sy, lift = 0.5) {
    if (this.selected && this.selected !== p) this.select(null);
    this.selected = null;
    p.dragging = true;
    const g = this.camera.unproject(sx, sy);
    this.drag = { p, origin: { x: p.x, y: p.y, cell: p.cell }, tx: g.x, ty: g.y, lift };
    this._liftTo(p, lift, 0.14);
  }

  dragTo(sx, sy) {
    if (!this.drag) return;
    const g = this.camera.unproject(sx, sy);
    this.drag.tx = g.x;
    this.drag.ty = g.y;
  }

  /** Cell under the dragged piece's shadow (i.e. under the finger). */
  dragCell() {
    if (!this.drag) return null;
    return this.cellAtWorld(this.drag.tx, this.drag.ty);
  }

  /** Ends the drag and returns the piece (the caller decides where it lands). */
  endDrag() {
    if (!this.drag) return null;
    const { p, tx, ty } = this.drag;
    p.x = tx;
    p.y = ty;
    p.dragging = false;
    this.drag = null;
    return p;
  }

  /** Invalid drop: fly the piece back where it came from. */
  async cancelDrag() {
    if (!this.drag) return;
    const { p, origin } = this.drag;
    p.dragging = false;
    this.drag = null;
    await this._flyTo(p, origin.x, origin.y, 0.32, 0.2);
    await this._dropTo(p, origin.x, origin.y, { impact: false });
  }

  // ───────────────────────── hit testing ─────────────────────────

  cellAtWorld(x, y) {
    const c = Math.floor(x + 1.5);
    const r = Math.floor(y + 1.5);
    if (c < 0 || c > 2 || r < 0 || r > 2) return null;
    return r * 3 + c;
  }

  cellAtScreen(sx, sy) {
    const g = this.camera.unproject(sx, sy);
    return this.cellAtWorld(g.x, g.y);
  }

  pieceAtScreen(sx, sy, filter = () => true) {
    const order = this._drawOrder().reverse();
    for (const p of order) {
      if (!filter(p)) continue;
      const pr = this.camera.project(p.x, p.y, p.z + PIECE_H);
      const r = PIECES[p.type].size * 0.56 * pr.s;
      const dx = sx - pr.x;
      const dy = (sy - pr.y) / this.camera.cos;
      if (dx * dx + dy * dy <= r * r) return p;
    }
    return null;
  }

  /** Converts a pointer event to canvas pixel coordinates. */
  eventToCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  // ───────────────────────── effects ─────────────────────────

  setWin(line, owner) {
    this.win = line ? { line, owner, t0: this.time } : null;
  }

  celebrate() {
    const { width: w } = this.canvas;
    const colors = ['#ffd45e', '#ff5d73', '#3fe0a5', '#5cc8ff', '#ffffff', '#c58bff'];
    for (let i = 0; i < 160; i++) {
      this.confetti.push({
        x: Math.random() * w,
        y: -Math.random() * this.canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 120 * this.dpr,
        vy: (120 + Math.random() * 200) * this.dpr,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 10,
        w: (6 + Math.random() * 6) * this.dpr,
        h: (3 + Math.random() * 4) * this.dpr,
        color: colors[i % colors.length],
        life: 3.5 + Math.random() * 1.5,
      });
    }
  }

  _burst(p) {
    const n = { sand: 26, chalk: 18, neon: 16, wood: 8, marble: 6 }[this.theme.id] || 8;
    const colors = this.theme.particles;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = 0.4 + Math.random() * 0.9;
      this.particles.push({
        x: p.x + Math.cos(a) * 0.2,
        y: p.y + Math.sin(a) * 0.2,
        z: 0.02,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: 0.6 + Math.random() * 1.3,
        life: 0.35 + Math.random() * 0.4,
        max: 0.75,
        size: 0.012 + Math.random() * 0.022,
        color: colors[i % colors.length],
      });
    }
    this.rings.push({ x: p.x, y: p.y, t: 0 });
  }

  // ───────────────────────── frame loop ─────────────────────────

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    this.time += dt;
    this._update(dt);
    this._draw();
    requestAnimationFrame(this._loop);
  }

  _update(dt) {
    for (const tw of this.tweens.slice()) {
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      tw.update(tw.easing(tw.t), tw.t);
      if (tw.t >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.resolve();
      }
    }
    if (this.drag) {
      const { p, tx, ty } = this.drag;
      const k = Math.min(1, dt * 28);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
    }
    for (const p of this.pieces) p.squash *= Math.exp(-dt * 14);
    for (const q of this.particles) {
      q.vz -= GRAVITY * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z = Math.max(0, q.z + q.vz * dt);
      q.vx *= 0.96;
      q.vy *= 0.96;
      q.life -= dt;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.45);
    const h = this.canvas.height;
    for (const c of this.confetti) {
      c.vy += 60 * this.dpr * dt;
      c.x += (c.vx + Math.sin(this.time * 3 + c.rot) * 40 * this.dpr) * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.life -= dt;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0 && c.y < h + 40);
  }

  _drawOrder() {
    return this.pieces.slice().sort((a, b) => {
      const la = a.dragging ? 2 : a.z > 0.08 ? 1 : 0;
      const lb = b.dragging ? 2 : b.z > 0.08 ? 1 : 0;
      return la - lb || a.y - b.y;
    });
  }

  /** Extra animated height for idle effects (thinking, selection, victory). */
  _bob(p) {
    let z = 0;
    if (this.thinking === p.owner && !p.dragging) {
      const s = Math.sin(this.time * 4.2 - p.idx * 1.4);
      z += s > 0 ? 0.06 * s * s : 0;
    }
    if (this.selected === p) z += 0.025 * Math.sin(this.time * 3.2);
    if (this.win && this.win.line.includes(p.cell)) {
      const t = this.time - this.win.t0;
      const i = this.win.line.indexOf(p.cell);
      z += 0.12 * Math.abs(Math.sin(t * 5 - i * 0.7)) * Math.exp(-t * 0.6) + 0.02 * (1 + Math.sin(t * 3 - i));
    }
    return z;
  }

  _draw() {
    const ctx = this.ctx;
    const cam = this.camera;
    const th = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.static, 0, 0);
    if (th.overlay) th.overlay(ctx, this, this.time);

    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.4);
    const hl = th.highlight;
    const additive = !!th.additive;

    for (const cell of this.blockedCells) this._drawBlocked(cell);

    // Interactive cells.
    for (const cell of this.interactiveCells) {
      const hover = cell === this.hoverCell;
      this._cellPath(cell);
      ctx.save();
      if (additive) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(hl, hover ? 0.26 : 0.07 + 0.07 * pulse);
      ctx.fill();
      ctx.lineWidth = (hover ? 3 : 1.8) * this.dpr;
      ctx.strokeStyle = rgba(hl, hover ? 0.95 : 0.35 + 0.3 * pulse);
      ctx.shadowColor = rgba(hl, 0.8);
      ctx.shadowBlur = (hover ? 16 : 8) * this.dpr;
      ctx.stroke();
      ctx.restore();
    }

    // Placements forbidden because they would complete a line: a red cross.
    for (const cell of this.forbiddenCells) this._drawForbidden(cell);

    // Danger cells (opponent can win there next move) — subtle red pulse.
    for (const cell of this.dangerCells) {
      this._cellPath(cell, 0.3);
      ctx.save();
      ctx.fillStyle = `rgba(255,70,70,${0.06 + 0.08 * pulse})`;
      ctx.fill();
      ctx.restore();
    }

    // Winning line glow (under the pieces).
    if (this.win) this._drawWinBeam(ctx, pulse);
    if (this.hint) this._drawHint(ctx, pulse);

    // Rings under interactive / selected pieces.
    for (const p of this.pieces) {
      const sel = p === this.selected;
      if (!sel && !this.interactivePieces.includes(p)) continue;
      const g = cam.project(p.x, p.y, 0);
      const r = PIECES[p.type].size * 0.6 * g.s;
      ctx.save();
      if (additive) ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, r, r * cam.cos, 0, 0, TAU);
      ctx.lineWidth = (sel ? 3 : 1.6) * this.dpr;
      ctx.strokeStyle = rgba(hl, sel ? 0.95 : 0.25 + 0.35 * pulse);
      ctx.shadowColor = rgba(hl, 0.9);
      ctx.shadowBlur = (sel ? 14 : 6) * this.dpr;
      ctx.stroke();
      ctx.restore();
    }

    // Impact rings.
    for (const r of this.rings) {
      const k = r.t / 0.45;
      const g = cam.project(r.x, r.y, 0);
      const rad = (0.25 + 0.35 * k) * g.s;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, rad, rad * cam.cos, 0, 0, TAU);
      ctx.strokeStyle = rgba(hl, 0.35 * (1 - k));
      ctx.lineWidth = 2 * this.dpr * (1 - k) + 0.5;
      ctx.stroke();
    }

    // Ghost preview of a placement.
    if (this.ghost && this.ghost.cell !== null) {
      const p = this.nextTrayPiece(this.ghost.owner);
      if (p) {
        const c = cellCenter(this.ghost.cell);
        this._drawSprite(p, c.x, c.y, 0, 0.38);
      }
    }

    const order = this._drawOrder();
    for (const p of order) this._drawShadow(p);
    for (const p of order) this._drawSprite(p, p.x, p.y, p.z + this._bob(p), 1);

    // Particles.
    if (this.particles.length) {
      ctx.save();
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (const q of this.particles) {
        const pr = cam.project(q.x, q.y, q.z);
        ctx.globalAlpha = Math.max(0, Math.min(1, q.life / 0.3));
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, Math.max(0.8, q.size * pr.s), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // Confetti (screen space).
    if (this.confetti.length) {
      for (const c of this.confetti) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.globalAlpha = Math.min(1, c.life);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.rot * 1.7)));
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  _cellPath(cell, inset = 0) {
    const ctx = this.ctx;
    const cam = this.camera;
    const { x: cx, y: cy } = cellCenter(cell);
    ctx.beginPath();
    this._cellOutlines[cell].forEach(([x, y], i) => {
      const px = cx + (x - cx) * (1 - inset);
      const py = cy + (y - cy) * (1 - inset);
      const p = cam.project(px, py, 0);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
  }

  _drawForbidden(cell) {
    const ctx = this.ctx;
    const cam = this.camera;
    const { x, y } = cellCenter(cell);
    this._cellPath(cell, 0.18);
    ctx.save();
    ctx.fillStyle = 'rgba(255,70,70,0.10)';
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.2 * this.dpr;
    ctx.strokeStyle = 'rgba(255,95,95,0.75)';
    ctx.shadowColor = 'rgba(255,60,60,0.6)';
    ctx.shadowBlur = 8 * this.dpr;
    const d = 0.17;
    for (const [ax, ay, bx, by] of [[-d, -d, d, d], [d, -d, -d, d]]) {
      const p = cam.project(x + ax, y + ay, 0);
      const q = cam.project(x + bx, y + by, 0);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A sealed cell: a raised granite block sitting in the square. */
  _drawBlocked(cell) {
    const ctx = this.ctx;
    const cam = this.camera;
    const { x: cx, y: cy } = cellCenter(cell);
    const pts = roundRectPoints(cx - 0.36, cy - 0.36, cx + 0.36, cy + 0.36, 0.1, 4);
    const Z = 0.16;
    const base = pts.map(([x, y]) => cam.project(x, y, 0));
    const top = pts.map(([x, y]) => cam.project(x, y, Z));
    const poly = (arr) => {
      ctx.beginPath();
      arr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    };
    ctx.save();
    // Cast shadow.
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 12 * this.dpr;
    ctx.shadowOffsetX = 4 * this.dpr;
    ctx.shadowOffsetY = 7 * this.dpr;
    poly(base);
    ctx.fillStyle = '#2a2623';
    ctx.fill();
    ctx.restore();
    // Sides.
    ctx.fillStyle = '#33302c';
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      ctx.beginPath();
      ctx.moveTo(base[i].x, base[i].y);
      ctx.lineTo(base[j].x, base[j].y);
      ctx.lineTo(top[j].x, top[j].y);
      ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath();
      ctx.fill();
    }
    // Top face.
    const a = cam.project(cx - 0.36, cy - 0.36, Z);
    const b = cam.project(cx + 0.36, cy + 0.36, Z);
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, '#9b958c');
    g.addColorStop(0.5, '#69645d');
    g.addColorStop(1, '#45413c');
    poly(top);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2 * this.dpr;
    ctx.stroke();
    // A couple of cracks.
    ctx.strokeStyle = 'rgba(20,18,16,0.6)';
    ctx.lineWidth = 1.3 * this.dpr;
    for (const crack of [[[-0.2, -0.3], [-0.05, -0.08], [0.02, 0.05], [0.22, 0.12]], [[-0.05, -0.08], [-0.2, 0.1], [-0.18, 0.28]]]) {
      ctx.beginPath();
      crack.forEach(([dx, dy], i) => {
        const p = cam.project(cx + dx, cy + dy, Z);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
    }
  }

  /** Suggested move: green ring on the piece, green target cell and a dashed arrow. */
  _drawHint(ctx, pulse) {
    const cam = this.camera;
    const col = [93, 255, 160];
    const { pieceId, to } = this.hint;
    const target = cellCenter(to);
    this._cellPath(to);
    ctx.save();
    ctx.fillStyle = rgba(col, 0.16 + 0.14 * pulse);
    ctx.fill();
    ctx.lineWidth = 3 * this.dpr;
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = 14 * this.dpr;
    ctx.stroke();
    ctx.restore();
    const p = pieceId && this.byId(pieceId);
    if (!p) return;
    const g = cam.project(p.x, p.y, 0);
    const r = PIECES[p.type].size * 0.62 * g.s;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, r, r * cam.cos, 0, 0, TAU);
    ctx.lineWidth = 3 * this.dpr;
    ctx.strokeStyle = rgba(col, 0.95);
    ctx.shadowColor = rgba(col, 0.9);
    ctx.shadowBlur = 14 * this.dpr;
    ctx.stroke();
    // Dashed arrow from the piece to the target.
    const q = cam.project(target.x, target.y, 0);
    const ang = Math.atan2(q.y - g.y, q.x - g.x);
    const len = Math.hypot(q.x - g.x, q.y - g.y);
    if (len > r * 2) {
      const sx = g.x + Math.cos(ang) * r;
      const sy = g.y + Math.sin(ang) * r * cam.cos;
      const ex = q.x - Math.cos(ang) * r * 0.8;
      const ey = q.y - Math.sin(ang) * r * 0.8;
      ctx.setLineDash([8 * this.dpr, 6 * this.dpr]);
      ctx.lineDashOffset = -this.time * 30 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      const h = 12 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.45) * h, ey - Math.sin(ang - 0.45) * h);
      ctx.lineTo(ex - Math.cos(ang + 0.45) * h, ey - Math.sin(ang + 0.45) * h);
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.95);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawWinBeam(ctx, pulse) {
    const cam = this.camera;
    const { line } = this.win;
    const a = cellCenter(line[0]);
    const b = cellCenter(line[2]);
    const dx = Math.sign(b.x - a.x) * 0.42;
    const dy = Math.sign(b.y - a.y) * 0.42;
    const p = cam.project(a.x - dx, a.y - dy, 0);
    const q = cam.project(b.x + dx, b.y + dy, 0);
    const s = (p.s + q.s) / 2;
    const col = this.theme.win;
    const t = this.time - this.win.t0;
    const grow = Math.min(1, t / 0.45);
    const ex = lerp(p.x, q.x, grow);
    const ey = lerp(p.y, q.y, grow);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [wd, al] of [[0.7, 0.12], [0.42, 0.22], [0.2, 0.5], [0.07, 0.95]]) {
      ctx.strokeStyle = rgba(col, al * (0.75 + 0.25 * pulse));
      ctx.lineWidth = wd * s;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    for (const cell of line) {
      const c = cellCenter(cell);
      const g = cam.project(c.x, c.y, 0);
      const r = (0.5 + 0.06 * pulse) * g.s;
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, r);
      grad.addColorStop(0, rgba(col, 0.45));
      grad.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, r, r * cam.cos, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawShadow(p) {
    const ctx = this.ctx;
    const cam = this.camera;
    const spr = this.sprites.get(p.spriteKey);
    if (!spr) return;
    const def = PIECES[p.type];
    const z = Math.max(0, p.z + this._bob(p));
    const base = this.theme.id === 'neon' ? 0.75 : 0.55;
    // Soft cast shadow, drifting away from the light as the piece rises.
    const off = 0.06 + z * 0.6;
    const g = cam.project(p.x + off * 0.55, p.y + off * 0.75, 0);
    const spread = 1 + z * 0.9;
    let wd = def.size * SPRITE_SPAN * g.s * spread;
    ctx.globalAlpha = base / (1 + z * 3.2);
    ctx.drawImage(spr.shadow, g.x - wd / 2, g.y - (wd * cam.cos) / 2, wd, wd * cam.cos);
    // Tight contact shadow while resting.
    if (z < 0.15) {
      const g0 = cam.project(p.x + 0.015, p.y + 0.03, 0);
      wd = def.size * SPRITE_SPAN * g0.s * 0.96;
      ctx.globalAlpha = 0.45 * (1 - z / 0.15);
      ctx.drawImage(spr.shadow, g0.x - wd / 2, g0.y - (wd * cam.cos) / 2, wd, wd * cam.cos);
    }
    ctx.globalAlpha = 1;
  }

  _drawSprite(p, x, y, z, alpha) {
    const ctx = this.ctx;
    const spr = this.sprites.get(p.spriteKey);
    if (!spr) return;
    const pr = this.camera.project(x, y, z + PIECE_H);
    const def = PIECES[p.type];
    const lift = 1 + Math.min(0.12, z * 0.12);
    let wd = def.size * SPRITE_SPAN * pr.s * lift;
    let ht = wd * this.camera.cos;
    wd *= 1 + 0.07 * p.squash;
    ht *= 1 - 0.12 * p.squash;
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr.canvas, pr.x - wd / 2, pr.y - ht / 2 - ht * 0.04, wd, ht);
    ctx.globalAlpha = 1;
  }
}
