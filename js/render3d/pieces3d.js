/**
 * Real 3D pieces built from parametric surfaces, with PBR materials painted on
 * canvas. Each piece stands with its base at y = 0; `seed` gives the three
 * pieces of a player their own natural shape and orientation.
 */
import * as THREE from 'three';
import { toTexture, normalFrom } from './surfaces.js';
import { makeCanvas } from '../render/texture.js';
import { mulberry32 } from '../core/rng.js';
import { PIECES } from '../render/pieces.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds a mesh from fn(u, v, out): u wraps around, v runs along the surface.
 * Normals come from finite differences of fn, so there are no visible seams.
 */
function surface(fn, nu, nv) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const nor = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uvs = new Float32Array((nu + 1) * (nv + 1) * 2);
  const idx = [];
  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = 0.0015;
  let k = 0;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const vv = Math.max(0.004, Math.min(0.996, v));
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      fn(u, v, p);
      fn(u - e, vv, a);
      fn(u + e, vv, b);
      fn(u, vv - e, c);
      fn(u, vv + e, d);
      n.crossVectors(b.sub(a), d.sub(c)).normalize();
      pos.set([p.x, p.y, p.z], k * 3);
      nor.set([n.x, n.y, n.z], k * 3);
      uvs.set([u, 1 - v], k * 2);
      k++;
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const q = j * row + i;
      idx.push(q, q + 1, q + row, q + 1, q + row + 1, q + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Scales a geometry to a target width and rests it on y = 0. */
function normalize(g, width) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  const s = width / w;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(s, s, s);
  return g;
}

const speckled = (w, h, base, specks, rng, count = 900, big = 2.4) => {
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    x.fillStyle = specks[Math.floor(rng() * specks.length)];
    x.globalAlpha = 0.2 + rng() * 0.6;
    x.beginPath();
    x.arc(rng() * w, rng() * h, 0.5 + rng() * big, 0, TAU);
    x.fill();
  }
  x.globalAlpha = 1;
  return c;
};

// ───────────────────────── stones ─────────────────────────

function stoneGeometry(seed) {
  const r = mulberry32(seed * 31 + 7);
  const p1 = r() * TAU;
  const p2 = r() * TAU;
  const p3 = r() * TAU;
  const ax = 0.92 + r() * 0.16;
  const az = 0.78 + r() * 0.2;
  const g = surface((u, v, o) => {
    const th = u * TAU;
    const ph = v * Math.PI;
    const dx = Math.sin(ph) * Math.cos(th);
    const dy = Math.cos(ph);
    const dz = Math.sin(ph) * Math.sin(th);
    const m = 1
      + 0.1 * Math.sin(2.1 * dx + p1) * Math.cos(1.7 * dz + p2)
      + 0.07 * Math.sin(3.3 * dy + 2.9 * dx + p3)
      + 0.025 * Math.sin(7 * dz + 6 * dy + p2);
    o.set(dx * m * ax, dy * m * 0.56, dz * m * az);
    if (o.y < -0.38) o.y = -0.38 + (o.y + 0.38) * 0.2;
  }, 64, 40);
  return g;
}

function stoneMaterial(team) {
  const rng = mulberry32(team + 5);
  const c = team === 0
    ? speckled(512, 256, '#bdb29d', ['#7d725e', '#efe8da', '#94896f', '#a88a68'], rng, 2200, 2.6)
    : speckled(512, 256, '#30343b', ['#15171a', '#8f96a0', '#3f464e', '#5e656e'], rng);
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(c),
    normalMap: toTexture(normalFrom(c, 0.5), { color: false }),
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.4,
    clearcoat: 0.55,
    clearcoatRoughness: 0.28,
  });
}

// ───────────────────────── bottle caps ─────────────────────────

function capGeometry() {
  const teeth = 21;
  const g = surface((u, v, o) => {
    const th = u * TAU;
    let r;
    let y;
    if (v < 0.5) {
      r = (v / 0.5) * 0.8;
      y = 0.34;
    } else if (v < 0.68) {
      const t = (v - 0.5) / 0.18;
      r = 0.8 + 0.14 * Math.sin((t * Math.PI) / 2);
      y = 0.34 - 0.07 * (1 - Math.cos((t * Math.PI) / 2));
    } else {
      const t = (v - 0.68) / 0.32;
      r = 0.94 + 0.1 * t;
      y = 0.27 - 0.27 * t;
    }
    const crimp = smooth(0.58, 0.9, v) * 0.075;
    r *= 1 + crimp * Math.cos(teeth * th);
    o.set(r * Math.cos(th), y, r * Math.sin(th));
  }, 252, 40);
  // Planar UVs so the printed design sits flat on top.
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2.2 + 0.5, p.getZ(i) / 2.2 + 0.5);
  return g;
}

function capMaterial(team) {
  const pal = team === 0
    ? { paint: '#e0ae37', ring: '#7c1d1d' }
    : { paint: '#c8202b', ring: '#f6f1e6' };
  const s = 512;
  const c = makeCanvas(s, s);
  const x = c.getContext('2d');
  x.fillStyle = pal.paint;
  x.fillRect(0, 0, s, s);
  x.translate(s / 2, s / 2);
  const k = s / 2.2;
  x.strokeStyle = pal.ring;
  x.fillStyle = pal.ring;
  x.lineWidth = 0.05 * k;
  x.beginPath();
  x.arc(0, 0, 0.6 * k, 0, TAU);
  x.stroke();
  x.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const r = (i % 2 ? 0.17 : 0.42) * k;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
  x.fill();
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(c),
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
}

// ───────────────────────── cigarette butts ─────────────────────────

function buttGeometry(seed) {
  const r = mulberry32(seed * 17 + 3);
  const p = r() * TAU;
  const R = 0.27;
  const g = surface((u, v, o) => {
    const th = u * TAU;
    const s = v * 2 - 1; // -1 filter mouth .. 1 burnt tip
    let rad = R;
    rad *= Math.min(1, smooth(0, 0.02, v) * 0.97 + 0.03);
    rad *= 1 - 0.3 * smooth(0.6, 0.95, v); // crushed towards the end
    if (v > 0.9) rad *= 1 + 0.16 * Math.sin(th * 5 + p) * smooth(0.9, 0.98, v);
    rad *= smooth(1, 0.975, v) * 0.96 + 0.04;
    rad *= 1 + 0.03 * Math.sin(th * 9 + v * 30 + p) * smooth(0.5, 0.7, v);
    o.set(s, R + rad * Math.cos(th), rad * Math.sin(th));
    o.y += 0.05 * Math.sin((s + 1) * 1.4); // a slight bend
  }, 40, 80);
  return g;
}

function buttMaterial(team) {
  const rng = mulberry32(team + 41);
  const W = 256;
  const H = 1024;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const at = (v) => (1 - v) * H; // texture v runs from tip to mouth
  const fill = (a, b, style) => {
    x.fillStyle = style;
    x.fillRect(0, at(b), W, at(a) - at(b));
  };
  fill(0, 0.53, team === 0 ? '#d98a3d' : '#f4f2ec');
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = team === 0 ? (rng() < 0.7 ? '#a65d20' : '#f0b26a') : '#d4cfc4';
    x.globalAlpha = 0.25 + rng() * 0.5;
    x.fillRect(rng() * W, at(0.53) + rng() * (at(0) - at(0.53)), 2 + rng() * 3, 1 + rng() * 2);
  }
  x.globalAlpha = 1;
  fill(0.53, 0.56, team === 0 ? '#e9c862' : '#c8ccd2');
  fill(0.56, 0.9, '#f7f5ef');
  const burn = x.createLinearGradient(0, at(0.72), 0, at(0.9));
  burn.addColorStop(0, 'rgba(210,170,110,0)');
  burn.addColorStop(0.7, 'rgba(180,130,70,0.75)');
  burn.addColorStop(1, 'rgba(60,40,20,1)');
  x.fillStyle = burn;
  x.fillRect(0, at(0.9), W, at(0.72) - at(0.9));
  fill(0.9, 1, '#3a3633');
  for (let i = 0; i < 300; i++) {
    x.fillStyle = rng() < 0.5 ? '#9a958e' : '#1e1c1a';
    x.fillRect(rng() * W, at(1) + rng() * (at(0.9) - at(1)), 3, 3);
  }
  x.strokeStyle = 'rgba(120,110,100,0.3)';
  for (let i = 0; i < 14; i++) {
    const y = at(0.6 + rng() * 0.28);
    x.beginPath();
    x.moveTo(0, y);
    x.quadraticCurveTo(W / 2, y + (rng() - 0.5) * 40, W, y);
    x.stroke();
  }
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(c),
    normalMap: toTexture(normalFrom(c, 0.35), { color: false }),
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.72,
  });
}

// ───────────────────────── wooden sticks ─────────────────────────

function tube(seed, len, R) {
  const r = mulberry32(seed * 13 + 9);
  const p = r() * TAU;
  const q = r() * TAU;
  return surface((u, v, o) => {
    const th = u * TAU;
    const s = (v * 2 - 1) * len;
    let rad = R * (1 + 0.1 * Math.sin(s * 3 + p));
    rad *= 1 + 0.05 * Math.sin(th * 7 + s * 5 + q);
    rad *= Math.min(1, smooth(0, 0.012, v) * 0.98 + 0.02) * (smooth(1, 0.988, v) * 0.98 + 0.02);
    o.set(s, R + rad * Math.cos(th) + 0.03 * Math.sin(s * 2 + p), rad * Math.sin(th));
  }, 28, 60);
}

function stickGeometries(seed) {
  const r = mulberry32(seed * 5 + 1);
  const a = tube(seed, 1, 0.14);
  const b = tube(seed + 3, 1, 0.13);
  const angle = 0.95 + r() * 0.5;
  b.rotateY(angle);
  b.translate(0, 0.17, 0); // rests on the lower stick
  return [a, b];
}

function stickMaterial(team) {
  const rng = mulberry32(team + 77);
  const pal = team === 0
    ? { base: '#cfa468', dark: '#6f4f25' }
    : { base: '#7a4126', dark: '#2e1408' };
  const W = 256;
  const H = 1024;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = pal.base;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    x.strokeStyle = pal.dark;
    x.globalAlpha = 0.12 + rng() * 0.4;
    x.lineWidth = 0.6 + rng() * 2;
    const px = rng() * W;
    const py = rng() * H;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + (rng() - 0.5) * 8, py + 30 + rng() * 120);
    x.stroke();
  }
  x.globalAlpha = 1;
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(c),
    normalMap: toTexture(normalFrom(c, 1), { color: false }),
    roughness: 0.68,
    clearcoat: 0.15,
  });
}

// ───────────────────────── olive pits ─────────────────────────

function pitGeometry(seed) {
  const r = mulberry32(seed * 23 + 11);
  const p = r() * TAU;
  const blunt = 0.85 + r() * 0.25;
  return surface((u, v, o) => {
    const th = u * TAU;
    const s = v * 2 - 1;
    const prof = Math.pow(Math.max(0, 1 - s * s), 0.78) * (1 + 0.12 * s * (blunt - 1));
    const ridge = 1 + 0.055 * Math.cos(9 * th + p + s * 1.5) + 0.02 * Math.sin(23 * th + s * 7);
    const rad = 0.47 * prof * ridge;
    o.set(s, 0.47 + rad * Math.cos(th), rad * Math.sin(th) * 0.92);
  }, 96, 72);
}

function pitMaterial(team) {
  const rng = mulberry32(team + 91);
  const c = team === 0
    ? speckled(512, 256, '#c9a67b', ['#7c5c3a', '#efdcbc', '#a98a60'], rng, 1600, 1.6)
    : speckled(512, 256, '#553631', ['#22110e', '#9a6e62', '#3c2420'], rng, 1600, 1.6);
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(c),
    normalMap: toTexture(normalFrom(c, 0.7), { color: false }),
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  });
}

// ───────────────────────── royal pawns ─────────────────────────

function pawnGeometry() {
  const pts = [
    [0, 1], [0.085, 0.99], [0.15, 0.95], [0.185, 0.885], [0.17, 0.82], [0.125, 0.775],
    [0.205, 0.752], [0.215, 0.73], [0.13, 0.7], [0.1, 0.62], [0.105, 0.5], [0.13, 0.38],
    [0.17, 0.27], [0.235, 0.19], [0.29, 0.155], [0.3, 0.12], [0.27, 0.1], [0.33, 0.07],
    [0.345, 0.04], [0.345, 0.012], [0.33, 0],
  ].reverse().map(([r, y]) => new THREE.Vector2(r, y));
  pts.unshift(new THREE.Vector2(0, 0));
  const curve = new THREE.SplineCurve(pts);
  return new THREE.LatheGeometry(curve.getPoints(140).map((q) => new THREE.Vector2(Math.max(0, q.x), q.y)), 64);
}

const pawnMaterial = (team) => new THREE.MeshPhysicalMaterial({
  color: team === 0 ? '#ffc95e' : '#eef2fa',
  metalness: 1,
  roughness: team === 0 ? 0.16 : 0.2,
  envMapIntensity: 2.5,
  clearcoat: 0.6,
  clearcoatRoughness: 0.15,
});

// ───────────────────────── gems ─────────────────────────

/** A brilliant-cut stone: flat facets over an octagonal girdle. */
function gemGeometry() {
  const n = 8;
  const ring = (r, y, off = 0) => Array.from({ length: n }, (_, i) => {
    const a = ((i + off) / n) * TAU;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  const table = ring(0.56, 0.86);
  const star = ring(0.8, 0.72, 0.5);
  const girdle = ring(1, 0.46);
  const lower = ring(0.62, 0.2, 0.5);
  const culet = new THREE.Vector3(0, 0, 0);
  const top = new THREE.Vector3(0, 0.86, 0);
  const tris = [];
  const add = (a, b, c) => tris.push(a, c, b);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    add(top, table[i], table[j]);
    add(table[i], star[i], table[j]);
    add(table[j], star[i], star[j]);
    add(star[i], girdle[j], star[j]);
    add(star[i], girdle[i], girdle[j]);
    add(girdle[i], lower[i], girdle[j]);
    add(girdle[j], lower[i], lower[j]);
    add(lower[i], culet, lower[j]);
  }
  const g = new THREE.BufferGeometry().setFromPoints(tris);
  g.computeVertexNormals();
  return g;
}

function gemMaterial(team, quality) {
  const c = team === 0 ? '#0fae6a' : '#e3122f';
  const base = {
    color: c,
    roughness: 0.04,
    flatShading: true,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 2.2,
    envMapIntensity: 2.4,
  };
  return new THREE.MeshPhysicalMaterial(quality === 'high'
    ? { ...base, metalness: 0.05, transmission: 0.82, thickness: 0.6, attenuationColor: new THREE.Color(c), attenuationDistance: 0.35 }
    : { ...base, metalness: 0.55 });
}

function gemSetting() {
  const pts = [[0.001, 0], [0.34, 0], [0.37, 0.02], [0.36, 0.07], [0.3, 0.1], [0.27, 0.13], [0.23, 0.13], [0.001, 0.08]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 48);
}

const goldMaterial = () => new THREE.MeshStandardMaterial({ color: '#ffc95e', metalness: 1, roughness: 0.18, envMapIntensity: 2.5 });

// ───────────────────────── assembly ─────────────────────────

const materials = new Map();
const geometries = new Map();

function memo(map, key, make) {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

/** Builds one piece as a group whose base rests on y = 0. */
export function buildPiece(type, team, seed, quality = 'high') {
  const size = PIECES[type].size;
  const yawRng = mulberry32(seed * 3 + 2);
  const group = new THREE.Group();
  const add = (g, m) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const variant = seed % 3;
  const key = `${type}:${variant}`;
  const mat = (make) => memo(materials, `${type}:${team}:${quality}`, make);

  if (type === 'stone') {
    add(memo(geometries, key, () => normalize(stoneGeometry(variant + 1), size)), mat(() => stoneMaterial(team)));
    group.rotation.y = yawRng() * TAU;
  } else if (type === 'cap') {
    add(memo(geometries, key, () => normalize(capGeometry(), size)), mat(() => capMaterial(team)));
    group.rotation.y = yawRng() * TAU;
  } else if (type === 'butt') {
    add(memo(geometries, key, () => normalize(buttGeometry(variant + 1), size)), mat(() => buttMaterial(team)));
    group.rotation.y = yawRng() * TAU;
  } else if (type === 'stick') {
    const pair = memo(geometries, key, () => {
      const [a, b] = stickGeometries(variant + 1);
      const s = size / 2;
      a.scale(s, s, s);
      b.scale(s, s, s);
      return [a, b];
    });
    const m = mat(() => stickMaterial(team));
    add(pair[0], m);
    add(pair[1], m);
    group.rotation.y = yawRng() * TAU;
  } else if (type === 'pit') {
    add(memo(geometries, key, () => normalize(pitGeometry(variant + 1), size)), mat(() => pitMaterial(team)));
    group.rotation.y = yawRng() * TAU;
  } else if (type === 'pawn') {
    const g = memo(geometries, 'pawn', () => {
      const p = pawnGeometry();
      const s = size / 0.69;
      p.scale(s, s * 1.0, s);
      return p;
    });
    add(g, mat(() => pawnMaterial(team)));
  } else if (type === 'gem') {
    const setting = memo(geometries, 'gem-set', () => {
      const s = gemSetting();
      s.scale(size * 1.28, size * 1.1, size * 1.28);
      return s;
    });
    const stone = memo(geometries, 'gem', () => {
      const g = gemGeometry();
      const k = size * 0.5;
      g.scale(k, k * 0.92, k);
      g.translate(0, size * 0.08, 0);
      return g;
    });
    add(setting, memo(materials, 'gold', goldMaterial));
    add(stone, mat(() => gemMaterial(team, quality)));
    group.rotation.y = (yawRng() * TAU) / 8;
  }
  return group;
}

/** Translucent copy of a piece, shown over the hovered cell while placing. */
export function ghostOf(group) {
  const g = group.clone(true);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.42;
    o.material.depthWrite = false;
    o.material.transmission = 0;
  });
  return g;
}
