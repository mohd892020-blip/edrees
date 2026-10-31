/**
 * Everything that glows or flies in the 3D world: cell highlights, selection
 * rings, the hint arrow, the winning beam, dust, impact sparks and gold leaf.
 */
import * as THREE from 'three';
import { toTexture, glowTile, dotTile, ringTile, crossTile } from './surfaces.js';
import { PIECES } from '../render/pieces.js';

const TAU = Math.PI * 2;
const cellPos = (cell) => [(cell % 3) - 1, Math.floor(cell / 3) - 1];
const GREEN = new THREE.Color('#5dffa0');
const RED = new THREE.Color('#ff4a4a');

const flat = (size, tex, { add = true } = {}) => {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
      blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  m.renderOrder = 2;
  return m;
};

const SPARK_MAX = 260;

export class Effects {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    const glow = toTexture(glowTile(), { aniso: 4 });
    const ring = toTexture(ringTile(), { aniso: 4 });
    const dot = toTexture(dotTile());
    const cross = toTexture(crossTile(), { aniso: 4 });

    this.cells = Array.from({ length: 9 }, (_, i) => {
      const m = flat(1, glow);
      const [x, z] = cellPos(i);
      m.position.set(x, 0.035, z);
      this.root.add(m);
      return m;
    });
    this.crosses = Array.from({ length: 9 }, (_, i) => {
      const m = flat(1, cross, { add: false });
      const [x, z] = cellPos(i);
      m.position.set(x, 0.04, z);
      m.material.color.copy(RED);
      this.root.add(m);
      return m;
    });
    this.rings = Array.from({ length: 7 }, () => {
      const m = flat(1, ring);
      this.root.add(m);
      return m;
    });
    this.impacts = Array.from({ length: 6 }, () => {
      const m = flat(1, ring);
      m.userData.t = 1;
      this.root.add(m);
      return m;
    });

    // Winning beam.
    this.beam = flat(1, dot);
    this.beam.geometry = new THREE.PlaneGeometry(1, 1);
    this.root.add(this.beam);
    this.haloes = [0, 1, 2].map(() => {
      const m = flat(1.5, dot);
      this.root.add(m);
      return m;
    });

    // Hint arrow: a dashed ribbon and a head.
    const dash = document.createElement('canvas');
    dash.width = 128;
    dash.height = 16;
    const dc = dash.getContext('2d');
    dc.fillStyle = '#fff';
    dc.fillRect(0, 0, 76, 16);
    this.dashTex = toTexture(dash, { repeat: 1 });
    this.arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.05),
      new THREE.MeshBasicMaterial({ map: this.dashTex, color: GREEN.clone().multiplyScalar(1.6), transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.visible = false;
    this.arrow.renderOrder = 3;
    this.root.add(this.arrow);
    const head = new THREE.Shape();
    head.moveTo(0.11, 0);
    head.lineTo(-0.07, 0.085);
    head.lineTo(-0.07, -0.085);
    head.closePath();
    this.arrowHead = new THREE.Mesh(
      new THREE.ShapeGeometry(head),
      new THREE.MeshBasicMaterial({ color: GREEN.clone().multiplyScalar(1.6), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    this.arrowHead.rotation.x = -Math.PI / 2;
    this.arrowHead.visible = false;
    this.arrowHead.renderOrder = 3;
    this.root.add(this.arrowHead);

    // Floating dust, catching the light.
    const n = 110;
    const dustPos = new Float32Array(n * 3);
    this.dustSeed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.dustSeed.set([Math.random() * TAU, Math.random() * TAU, 0.3 + Math.random()], i * 3);
      dustPos.set([(Math.random() - 0.5) * 9, Math.random() * 3.6 + 0.1, (Math.random() - 0.5) * 9], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      map: dot, size: 0.045, color: '#dfe8ff', transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    }));
    this.root.add(this.dust);

    // Impact sparks (a small particle pool with per-particle alpha).
    this.sparks = [];
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(SPARK_MAX * 3);
    this.sCol = new Float32Array(SPARK_MAX * 4);
    this.sSize = new Float32Array(SPARK_MAX);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute('aColor', new THREE.BufferAttribute(this.sCol, 4));
    sg.setAttribute('aSize', new THREE.BufferAttribute(this.sSize, 1));
    this.sparkPoints = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: dot }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;
        void main() { vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec4 vColor;
        void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); }`,
    }));
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 4;
    this.root.add(this.sparkPoints);

    // Gold leaf confetti.
    this.leaf = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.075, 0.042),
      new THREE.MeshStandardMaterial({ color: '#ffcf6b', metalness: 1, roughness: 0.3, envMapIntensity: 2.3, side: THREE.DoubleSide }),
      160,
    );
    this.leaf.frustumCulled = false;
    this.leaf.visible = false;
    this.leaves = [];
    this.root.add(this.leaf);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
  }

  setLook(look) {
    const c = new THREE.Color(look.glow);
    this.glowColor = c;
    const blending = look.glowAdd ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [...this.cells, ...this.rings, ...this.impacts]) {
      m.material.blending = blending;
      m.material.needsUpdate = true;
    }
    this.dust.visible = !!look.key;
  }

  burst(x, y, colors, count = 14, color = null) {
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= SPARK_MAX) this.sparks.shift();
      const a = Math.random() * TAU;
      const sp = 0.5 + Math.random() * 1.1;
      c.set(color || colors[i % colors.length]);
      this.sparks.push({
        x: x + Math.cos(a) * 0.18, y: 0.03, z: y + Math.sin(a) * 0.18,
        vx: Math.cos(a) * sp, vy: 0.7 + Math.random() * 1.5, vz: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5, max: 0.9, size: 0.03 + Math.random() * 0.05, r: c.r, g: c.g, b: c.b,
      });
    }
    const ring = this.impacts.find((m) => m.userData.t >= 1) || this.impacts[0];
    ring.position.set(x, 0.03, y);
    ring.userData.t = 0;
    ring.visible = true;
    ring.material.color.copy(this.glowColor);
  }

  celebrate() {
    this.leaves = [];
    for (let i = 0; i < this.leaf.count; i++) {
      this.leaves.push({
        x: (Math.random() - 0.5) * 7, y: 4 + Math.random() * 5, z: (Math.random() - 0.5) * 6,
        vy: -(1 + Math.random() * 1.2), rx: Math.random() * TAU, ry: Math.random() * TAU,
        wx: (Math.random() - 0.5) * 7, wy: (Math.random() - 0.5) * 7, ph: Math.random() * TAU,
      });
    }
    this.leaf.visible = true;
  }

  clear() {
    this.sparks = [];
    this.leaves = [];
    this.leaf.visible = false;
    this.beam.visible = false;
    for (const h of this.haloes) h.visible = false;
    for (const m of this.impacts) {
      m.visible = false;
      m.userData.t = 1;
    }
  }

  update(w, dt) {
    const t = w.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
    const col = this.glowColor;
    const add = !!w.set.look.glowAdd;

    // Cells.
    for (let i = 0; i < 9; i++) {
      const m = this.cells[i];
      const mat = m.material;
      let a = 0;
      let c = col;
      if (w.hint && w.hint.to === i) {
        a = 0.5 + 0.35 * pulse;
        c = GREEN;
      } else if (w.hoverCell === i) a = add ? 0.75 : 0.62;
      else if (w.interactiveCells.includes(i)) a = ((add ? 0.3 : 0.34) + 0.22 * pulse) * (w.set.look.glowI ?? 1);
      else if (w.dangerCells.includes(i)) {
        a = 0.22 + 0.22 * pulse;
        c = RED;
      }
      m.visible = a > 0;
      if (a > 0) {
        mat.opacity = a;
        mat.color.copy(c);
      }
      const x = this.crosses[i];
      x.visible = w.forbiddenCells.includes(i);
      if (x.visible) x.material.opacity = 0.7 + 0.2 * pulse;
    }

    // Rings under movable / selected / hinted pieces.
    let r = 0;
    const hintPiece = w.hint && w.hint.pieceId;
    for (const p of w.pieces) {
      const sel = p === w.selected;
      const hinted = p.id === hintPiece;
      if (!sel && !hinted && !w.interactivePieces.includes(p)) continue;
      const m = this.rings[r++];
      if (!m) break;
      const size = PIECES[p.type].size * 1.5;
      m.scale.set(size, size, 1);
      m.position.set(p.x, 0.04, p.y);
      m.material.color.copy(hinted ? GREEN : col);
      m.material.opacity = sel || hinted ? 0.95 : 0.3 + 0.35 * pulse;
      m.visible = true;
    }
    for (; r < this.rings.length; r++) this.rings[r].visible = false;

    // Impact rings.
    for (const m of this.impacts) {
      if (m.userData.t >= 1) {
        m.visible = false;
        continue;
      }
      m.userData.t = Math.min(1, m.userData.t + dt / 0.5);
      const k = m.userData.t;
      const s = 0.6 + 1.1 * k;
      m.scale.set(s, s, 1);
      m.material.opacity = 0.6 * (1 - k);
    }

    // Hint arrow.
    const show = w.hint && hintPiece && w.byId(hintPiece);
    const p = show ? w.byId(hintPiece) : null;
    if (p) {
      const tx = (w.hint.to % 3) - 1;
      const tz = Math.floor(w.hint.to / 3) - 1;
      const dx = tx - p.x;
      const dz = tz - p.y;
      const len = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      const L = Math.max(0.05, len - 0.72);
      this.arrow.visible = true;
      this.arrow.scale.x = L;
      this.arrow.position.set(p.x + (dx / len) * (0.34 + L / 2), 0.06, p.y + (dz / len) * (0.34 + L / 2));
      this.arrow.rotation.z = -ang;
      this.dashTex.repeat.x = L * 5;
      this.dashTex.offset.x = -t * 1.2;
      this.arrowHead.visible = true;
      this.arrowHead.position.set(p.x + (dx / len) * (0.34 + L + 0.05), 0.06, p.y + (dz / len) * (0.34 + L + 0.05));
      this.arrowHead.rotation.z = -ang;
    } else {
      this.arrow.visible = false;
      this.arrowHead.visible = false;
    }

    // Winning beam.
    if (w.win) {
      const { line } = w.win;
      const [ax, az] = cellPos(line[0]);
      const [bx, bz] = cellPos(line[2]);
      const grow = Math.min(1, (t - w.win.t0) / 0.45);
      const len = Math.hypot(bx - ax, bz - az) + 0.9;
      this.beam.visible = true;
      this.beam.scale.set(len * grow, 0.7, 1);
      this.beam.position.set((ax + bx) / 2, 0.05, (az + bz) / 2);
      this.beam.rotation.z = -Math.atan2(bz - az, bx - ax);
      this.beam.material.color.set(w.set.id === 'neon' ? '#ff3df5' : '#ffe6a8').multiplyScalar(1.5);
      this.beam.material.opacity = 0.75 + 0.2 * pulse;
      line.forEach((cell, i) => {
        const h = this.haloes[i];
        const [x, z] = cellPos(cell);
        h.visible = true;
        h.position.set(x, 0.055, z);
        h.material.color.copy(this.beam.material.color);
        h.material.opacity = (0.55 + 0.25 * pulse) * grow;
      });
    } else {
      this.beam.visible = false;
      for (const h of this.haloes) h.visible = false;
    }

    // Dust.
    if (this.dust.visible) {
      const a = this.dust.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const sp = this.dustSeed[i * 3 + 2];
        let y = a.getY(i) + dt * 0.05 * sp;
        if (y > 3.8) y = 0.1;
        a.setXYZ(
          i,
          a.getX(i) + Math.sin(t * 0.3 * sp + this.dustSeed[i * 3]) * dt * 0.04,
          y,
          a.getZ(i) + Math.cos(t * 0.27 * sp + this.dustSeed[i * 3 + 1]) * dt * 0.04,
        );
      }
      a.needsUpdate = true;
    }

    // Sparks.
    this.sparks = this.sparks.filter((q) => (q.life -= dt) > 0);
    this.sparks.forEach((q, i) => {
      q.vy -= 7 * dt;
      q.x += q.vx * dt;
      q.z += q.vz * dt;
      q.y = Math.max(0.01, q.y + q.vy * dt);
      q.vx *= 0.97;
      q.vz *= 0.97;
      this.sPos.set([q.x, q.y, q.z], i * 3);
      this.sCol.set([q.r, q.g, q.b, Math.min(1, q.life / 0.25)], i * 4);
      this.sSize[i] = q.size;
    });
    const g = this.sparkPoints.geometry;
    g.setDrawRange(0, this.sparks.length);
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.sparkPoints.material.uniforms.uScale.value = w.canvas.height * 0.9;

    // Gold leaf.
    if (this.leaf.visible) {
      let alive = 0;
      this.leaves.forEach((l, i) => {
        l.y += l.vy * dt;
        l.x += Math.sin(t * 2 + l.ph) * dt * 0.35;
        l.rx += l.wx * dt;
        l.ry += l.wy * dt;
        if (l.y > -0.5) alive++;
        this.e.set(l.rx, l.ry, 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(l.x, l.y, l.z), this.q, this.s);
        this.leaf.setMatrixAt(i, this.m4);
      });
      this.leaf.instanceMatrix.needsUpdate = true;
      if (!alive) this.leaf.visible = false;
    }
  }
}
