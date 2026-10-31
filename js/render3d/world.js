/**
 * The 3D world: a persistent WebGL scene that lives behind every screen.
 * It inherits all piece logic (tweens, drag, selection, hit-testing) from the
 * 2D Renderer and replaces only the drawing, so the rest of the game cannot
 * tell them apart. If WebGL is unavailable the 2D Renderer is used instead.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Renderer, Ease } from '../render/renderer.js';
import { PIECES } from '../render/pieces.js';
import { CameraRig } from './rig.js';
import { boardSet, environmentFor } from './boards.js';
import { buildPiece, ghostOf } from './pieces3d.js';
import { Effects } from './effects.js';
import { Coin3D, COIN_REST } from './coin.js';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/** Approximate height of each piece, for picking tall pieces by their top. */
const PIECE_TOP = { pawn: 0.72, gem: 0.3, stone: 0.3, cap: 0.12, stick: 0.3, pit: 0.28, butt: 0.2 };

/** Vignette, a whisper of warmth and fine grain: the cinematic finish. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.42 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.28, length(d * vec2(1.05, 1.0)));
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      c.rgb *= vec3(1.015, 1.0, 0.975);
      c.rgb += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012 * c.rgb;
      gl_FragColor = c;
    }`,
};

/** True when a real GPU can carry the world; `?quality` forces it for testing. */
export function webglAvailable() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    if (new URLSearchParams(location.search).has('quality')) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    return !/swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export class World3D extends Renderer {
  constructor(canvas, opts) {
    super(canvas, { ...opts, webgl: true });
    this.is3D = true;
    const forced = new URLSearchParams(location.search).get('quality');
    const small = Math.min(screen.width, screen.height) < 700 || matchMedia('(pointer: coarse)').matches;
    this.quality = forced || (small ? 'medium' : 'high');
    this.scaleDown = 1;
    this.camera = new CameraRig();

    const gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    gl.setPixelRatio(1);
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl = gl;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#06070b');
    scene.fog = new THREE.Fog('#06070b', 14, 28);
    this.scene = scene;

    this.hemi = new THREE.HemisphereLight('#ffffff', '#000000', 0.4);
    scene.add(this.hemi);
    const shadowSize = this.quality === 'high' ? 2048 : 1024;
    this.spot = new THREE.SpotLight('#fff', 300, 30, 0.42, 0.75, 2);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(shadowSize, shadowSize);
    this.spot.shadow.bias = -0.0003;
    this.spot.shadow.normalBias = 0.015;
    this.spot.shadow.radius = 5;
    scene.add(this.spot, this.spot.target);
    this.sun = new THREE.DirectionalLight('#fff', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    Object.assign(this.sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 24 });
    scene.add(this.sun, this.sun.target);

    this.setRoot = new THREE.Group();
    this.pedestals = new THREE.Group();
    this.pieceRoot = new THREE.Group();
    scene.add(this.setRoot, this.pedestals, this.pieceRoot);
    this.meshes = new Map();
    this.ghostMesh = null;
    this.ghostKey = '';

    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(gl, rt);
    this.composer.addPass(new RenderPass(scene, this.camera.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());

    this.fx = new Effects(scene);
    this.coin = new Coin3D(scene);

    this.mode = 'menu';
    this.poseTween = null;
    this.shake = 0;
    this.swayTarget = { x: 0, y: 0 };
    this.set = null;
    this.frames = { t: 0, n: 0 };
    window.addEventListener('pointermove', (e) => {
      this.swayTarget.x = (e.clientX / window.innerWidth - 0.5) * 0.05;
      this.swayTarget.y = (e.clientY / window.innerHeight - 0.5) * -0.025;
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._last = performance.now();
    });
  }

  // ───────────────────────── size and layout ─────────────────────────

  resize() {
    const parent = this.canvas.parentElement;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    if (!cw || !ch) return;
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.6 : 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, cap) * this.scaleDown;
    const w = Math.round(cw * this.dpr);
    const h = Math.round(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.gl.setSize(w, h, false);
      this.composer.setSize(w, h);
    }
    this.camera.setViewport(w, h);
    if (!this.set) this._rebuild();
    this._layout();
    this._snapTrayPieces();
  }

  _traySlots() {
    if (this.orientation === 'portrait') {
      return [
        [0.92, 0, -0.92].map((x) => ({ x, y: 2.6 })),
        [-0.92, 0, 0.92].map((x) => ({ x, y: -2.6 })),
      ];
    }
    return [
      [-0.92, 0, 0.92].map((y) => ({ x: 2.72, y })),
      [-0.92, 0, 0.92].map((y) => ({ x: -2.72, y })),
    ];
  }

  _layout() {
    const { width: w, height: h } = this.canvas;
    this.orientation = w / h > 1.12 ? 'landscape' : 'portrait';
    this.trays = this._traySlots();
    if (this.set) this._placePedestals();
    const B = 2.08;
    const T = this.set ? this.set.thickness : 0;
    const pts = [[-B, -B], [B, -B], [-B, B, -T], [B, B, -T]];
    if (this.orientation === 'portrait') pts.push([-1.4, -3.05, 0.5], [1.4, -3.05, 0.5], [-1.4, 3.05, -T], [1.4, 3.05, -T]);
    else pts.push([-3.15, -1.4, 0.4], [3.15, -1.4, 0.4], [-3.15, 1.45, -T], [3.15, 1.45, -T]);
    const ins = this.getInsets ? this.getInsets() : { top: 0, bottom: 0 };
    const top = ins.top * this.dpr;
    const bottom = ins.bottom * this.dpr;
    const pad = Math.min(w, h) * 0.025;
    this.gamePose = this.camera.fit(pts, { x: 0, y: top, width: w, height: Math.max(80, h - top - bottom) }, pad, {
      az: 0, el: 57 * RAD, tx: 0, ty: 0, tz: 0,
    });
    if (!this.poseTween) this.camera.pose = this._poseFor(this.mode);
  }

  _poseFor(mode) {
    const { width: w, height: h } = this.canvas;
    const wide = w / h > 1.12;
    if (mode === 'menu') {
      return { az: this.camera.pose.az, el: 29 * RAD, radius: wide ? 11.5 : Math.max(14.5, (8.6 * h) / w), tx: 0, ty: 0, tz: 0, ox: wide ? w * 0.17 : 0, oy: wide ? 0 : -h * 0.03 };
    }
    if (mode === 'showcase') {
      return { az: this.camera.pose.az, el: 38 * RAD, radius: wide ? 15 : 17, tx: 0, ty: 0, tz: 0, ox: 0, oy: h * 0.19 };
    }
    if (mode === 'toss') return { az: 0, el: 42 * RAD, radius: wide ? 13.6 : Math.max(15, (9.5 * h) / w), tx: 0, ty: 0.6, tz: 0, ox: 0, oy: h * (wide ? 0.115 : 0.08) };
    return this.gamePose;
  }

  /** Glides the camera to another framing: menu, showcase, toss or game. */
  setMode(mode, { snap = false } = {}) {
    if (this.mode === mode && !snap && !this.poseTween) return Promise.resolve();
    this.mode = mode;
    this.pedestals.visible = mode === 'game' || mode === 'toss';
    const to = this._poseFor(mode);
    if (snap) {
      this.camera.pose = to;
      return Promise.resolve();
    }
    const from = { ...this.camera.pose };
    from.az = ((from.az + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const token = {};
    this.poseTween = token;
    const glide = this._tween(1.5, (e) => {
      if (this.poseTween !== token) return;
      const target = this._poseFor(this.mode);
      const p = this.camera.pose;
      for (const k of ['el', 'radius', 'tx', 'ty', 'tz', 'ox', 'oy']) p[k] = lerp(from[k], target[k], e);
      p.az = lerp(from.az, mode === 'menu' || mode === 'showcase' ? from.az : target.az, e);
    }, Ease.inOutCubic);
    this.tweens[this.tweens.length - 1].keep = true; // resetting pieces must not stop the camera
    return glide.then(() => {
      if (this.poseTween === token) this.poseTween = null;
    });
  }

  // ───────────────────────── theme and pieces ─────────────────────────

  _rebuild() {
    const size = this.quality === 'high' ? 1536 : 1024;
    const set = boardSet(this.theme.id, size);
    if (this.set !== set) {
      this.setRoot.clear();
      this.setRoot.add(set.group);
      this.set = set;
      this._applyLook(set.look);
      this._placePedestals();
    }
    this._staticKey = this.theme.id;
    this._buildSprites();
  }

  _applyLook(look) {
    const { scene, gl } = this;
    scene.background.set(look.bg);
    scene.fog.color.set(look.bg);
    scene.environment = environmentFor(gl, look.env);
    scene.environmentIntensity = look.envI;
    gl.toneMappingExposure = look.exposure;
    this.hemi.color.set(look.fill.sky);
    this.hemi.groundColor.set(look.fill.ground);
    this.hemi.intensity = look.fill.intensity;
    this.spot.visible = !!look.key;
    this.sun.visible = !!look.sun;
    if (look.key) {
      this.spot.color.set(look.key.color);
      this.spot.intensity = look.key.intensity;
      this.spot.position.set(...look.key.pos);
      this.spot.angle = look.key.angle;
      this.spot.target.position.set(0, 0, 0);
    }
    if (look.sun) {
      this.sun.color.set(look.sun.color);
      this.sun.intensity = look.sun.intensity;
      this.sun.position.set(...look.sun.pos);
    }
    this.bloom.strength = this.quality === 'low' ? 0 : look.bloom.strength;
    this.bloom.radius = look.bloom.radius;
    this.bloom.threshold = look.bloom.threshold;
    this.fx.setLook(look);
  }

  _placePedestals() {
    this.pedestals.clear();
    if (!this.set.pedestal || !this.trays) return;
    for (const owner of [0, 1]) {
      for (const s of this.trays[owner]) {
        const p = this.set.pedestal.clone(true);
        p.position.set(s.x, 0, s.y);
        this.pedestals.add(p);
      }
    }
  }

  /** Builds or refreshes the mesh of every piece. */
  _buildSprites() {
    if (!this.meshes) return;
    const wanted = new Set();
    for (const p of this.pieces) {
      const key = `${p.type}:${p.owner}:${p.seed % 3}:${p.id}`;
      wanted.add(key);
      if (!this.meshes.has(key)) {
        const m = buildPiece(p.type, p.owner, p.seed, this.quality);
        this.meshes.set(key, m);
        this.pieceRoot.add(m);
      }
      p.meshKey = key;
    }
    for (const [key, m] of this.meshes) {
      if (!wanted.has(key)) {
        this.pieceRoot.remove(m);
        this.meshes.delete(key);
      }
    }
  }

  resetPieces(seed) {
    super.resetPieces(seed);
    if (this.fx) this.fx.clear();
  }

  pieceAtScreen(sx, sy, filter = () => true) {
    const order = this._drawOrder().reverse();
    for (const p of order) {
      if (!filter(p)) continue;
      const lo = this.camera.project(p.x, p.y, p.z + 0.05);
      const hi = this.camera.project(p.x, p.y, p.z + (PIECE_TOP[p.type] || 0.25));
      const r = Math.max(PIECES[p.type].size * 0.56, 0.3) * lo.s;
      for (const c of [lo, hi]) {
        if ((sx - c.x) ** 2 + ((sy - c.y) / this.camera.cos) ** 2 <= r * r) return p;
      }
    }
    return null;
  }

  /** Places pieces on the board for the menu backdrop. */
  showDemo(board) {
    this.syncToState({ board });
  }

  // ───────────────────────── effects ─────────────────────────

  _burst(p) {
    const n = { sand: 30, chalk: 24, neon: 26, wood: 12, marble: 12 }[this.theme.id] || 12;
    this.fx.burst(p.x, p.y, this.theme.particles, n);
  }

  celebrate() {
    this.fx.celebrate();
    this.fx.burst(0, 0, ['#ffd98a', '#fff3c4', '#ffb84d'], 60);
  }

  /**
   * The toss, played in the world: the coin flies up from the board, turns
   * and lands showing the winner's side. `onLand` fires at the first impact.
   */
  async playToss(starter, names, onLand) {
    const { coin } = this;
    coin.setNames(names[0], names[1]);
    const g = coin.group;
    g.visible = true;
    g.position.set(0, COIN_REST, 0);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(1);
    const turns = 5 + Math.floor(Math.random() * 3);
    const final = turns * TAU + (starter === 0 ? 0 : Math.PI);
    const top = 4.1;
    // Anticipation, then the throw.
    await this._tween(0.26, (e) => {
      g.position.y = COIN_REST + 0.28 * Math.sin(e * Math.PI) * 0.4;
    }, Ease.inOutCubic);
    await this._tween(2.2, (_, t) => {
      g.position.y = COIN_REST + top * 4 * t * (1 - t);
      const spin = Ease.outCubic(t) * 0.25 + t * 0.75;
      g.rotation.x = final * spin;
      g.rotation.z = Math.sin(t * 9) * 0.1 * (1 - t);
    }, Ease.linear);
    g.rotation.x = final;
    g.rotation.z = 0;
    this.shake = 1;
    this.fx.burst(0, 0, ['#ffd98a', '#fff3c4', '#ffb84d'], 46);
    if (onLand) onLand();
    // Two settling hops.
    await this._tween(0.5, (_, t) => {
      g.position.y = COIN_REST + 0.34 * (1 - t) ** 2 * Math.abs(Math.sin(t * Math.PI * 2));
    }, Ease.linear);
    g.position.y = COIN_REST;
  }

  /** Lifts the coin out of the scene. */
  hideCoin() {
    const g = this.coin.group;
    const y0 = g.position.y;
    return this._tween(0.55, (e) => {
      g.position.y = y0 + e * 5;
      g.rotation.x += 0.2;
      g.scale.setScalar(1 - e * 0.6);
    }, Ease.inOutCubic).then(() => {
      g.visible = false;
    });
  }

  // ───────────────────────── frame loop ─────────────────────────

  _loop(now) {
    if (!this.running) return;
    const raw = (now - this._last) / 1000;
    const dt = Math.min(0.25, Math.max(0, raw)); // a slow device keeps its pace instead of going slow-motion
    this._last = now;
    this.time += dt;
    this._update(dt);
    this._draw(dt);
    this._watchFrameRate(raw);
    requestAnimationFrame(this._loop);
  }

  /** Lowers the internal resolution if the device can't keep up. */
  _watchFrameRate(raw) {
    if (raw > 0.5) return;
    const f = this.frames;
    f.t += raw;
    f.n++;
    if (f.t < 2.5) return;
    const fps = f.n / f.t;
    f.t = 0;
    f.n = 0;
    if (fps < 28 && this.scaleDown > 0.6 && !new URLSearchParams(location.search).has('quality')) {
      this.scaleDown = Math.max(0.6, this.scaleDown - 0.15);
      this.resize();
    }
  }

  _draw(dt = 0.016) {
    if (!this.set) return;
    const { camera: rig } = this;
    // Camera drift and parallax.
    if ((this.mode === 'menu' || this.mode === 'showcase')) rig.pose.az += dt * 0.05;
    const k = Math.min(1, dt * 2.5);
    const parallax = this.mode === 'game' ? 0 : 1;
    rig.sway.x += (this.swayTarget.x * parallax - rig.sway.x) * k;
    rig.sway.y += (this.swayTarget.y * parallax - rig.sway.y) * k;
    if (this.shake > 0.001) {
      rig.sway.x += (Math.random() - 0.5) * 0.012 * this.shake;
      rig.sway.y += (Math.random() - 0.5) * 0.012 * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }
    rig.apply();
    this.scene.fog.near = rig.pose.radius + 3;
    this.scene.fog.far = rig.pose.radius + 15;

    for (const p of this.pieces) {
      const m = this.meshes.get(p.meshKey);
      if (!m) continue;
      m.position.set(p.x, Math.max(0, p.z + this._bob(p)), p.y);
      const s = p.squash;
      m.scale.set(1 + 0.07 * s, 1 - 0.12 * s, 1 + 0.07 * s);
    }
    this._drawGhost();
    if (this.set.update) this.set.update(this.time);
    this.fx.update(this, dt);
    this.finish.uniforms.uTime.value = this.time % 10;
    this.composer.render(dt);
  }

  _drawGhost() {
    const g = this.ghost && this.ghost.cell !== null ? this.nextTrayPiece(this.ghost.owner) : null;
    if (!g) {
      if (this.ghostMesh) this.ghostMesh.visible = false;
      return;
    }
    if (this.ghostKey !== g.meshKey) {
      if (this.ghostMesh) this.pieceRoot.remove(this.ghostMesh);
      this.ghostMesh = ghostOf(this.meshes.get(g.meshKey));
      this.ghostKey = g.meshKey;
      this.pieceRoot.add(this.ghostMesh);
    }
    this.ghostMesh.visible = true;
    this.ghostMesh.position.set((this.ghost.cell % 3) - 1, 0, Math.floor(this.ghost.cell / 3) - 1);
    this.ghostMesh.scale.set(1, 1, 1);
  }
}
