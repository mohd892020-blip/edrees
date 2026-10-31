/**
 * The five boards as real 3D sets: geometry, PBR materials, lighting look and
 * a procedural reflection environment (softboxes rendered into an env map).
 */
import * as THREE from 'three';
import {
  woodTop, marbleTop, glassTop, fabricMaps, lacquerMaps, neonFloorMaps, toTexture, normalFrom,
} from './surfaces.js';
import { THEMES, paintWorldTexture } from '../render/themes.js';

/** Light, colour and post-processing mood of each board. */
export const LOOKS = {
  wood: {
    bg: '#02100d', exposure: 0.92, env: 'gallery', envI: 0.4,
    key: { color: '#f6f7ff', intensity: 165, pos: [-3.6, 9.4, 3.4], angle: 0.4 },
    fill: { sky: '#5f7fa0', ground: '#04100c', intensity: 0.12 },
    bloom: { strength: 0.18, radius: 0.5, threshold: 0.95 },
    glow: '#2fd6a0', glowAdd: true, glowI: 0.75,
  },
  marble: {
    bg: '#030614', exposure: 0.9, env: 'gallery', envI: 0.44,
    key: { color: '#f4f6ff', intensity: 190, pos: [-3.6, 9.4, 3.2], angle: 0.42 },
    fill: { sky: '#4a68c8', ground: '#061038', intensity: 0.22 },
    bloom: { strength: 0.2, radius: 0.55, threshold: 0.95 },
    glow: '#2f6bff', glowAdd: false,
  },
  sand: {
    bg: '#03040a', exposure: 0.9, env: 'gallery', envI: 0.44,
    sun: { color: '#dfe7ff', intensity: 2.7, pos: [-6.5, 5.2, 3.2] },
    fill: { sky: '#7f9be0', ground: '#1a2750', intensity: 0.7 },
    bloom: { strength: 0.14, radius: 0.5, threshold: 0.96 },
    glow: '#2f6bff', glowAdd: false, glowI: 0.8,
  },
  chalk: {
    bg: '#03040a', exposure: 0.98, env: 'gallery', envI: 0.44,
    sun: { color: '#eaf0ff', intensity: 3, pos: [-6, 6, 2.6] },
    fill: { sky: '#8ea2cc', ground: '#14161d', intensity: 0.55 },
    bloom: { strength: 0.12, radius: 0.5, threshold: 0.96 },
    glow: '#cfdcff', glowAdd: true, glowI: 0.6,
  },
  neon: {
    bg: '#04030c', exposure: 0.95, env: 'neon', envI: 0.5,
    key: { color: '#e4e8ff', intensity: 140, pos: [-2.5, 9, 3], angle: 0.5 },
    fill: { sky: '#2a2070', ground: '#14062a', intensity: 0.5 },
    bloom: { strength: 0.32, radius: 0.6, threshold: 1.0 },
    glow: '#29f3ff', glowAdd: true, glowI: 0.5,
  },
};

// ───────────────────────── reflections ─────────────────────────

const ENV_PANELS = {
  gallery: {
    room: '#0a1230',
    panels: [
      { pos: [0, 9, 0], size: [5, 4], color: '#ffffff', i: 9 },
      { pos: [0, 8, -8], size: [14, 7], color: '#f4f6ff', i: 1.9 },
      { pos: [-9, 3, 0], size: [1.4, 10], color: '#ffffff', i: 12 },
      { pos: [9, 3, 2], size: [1.4, 10], color: '#a9c2ff', i: 8 },
      { pos: [-8, 2, 7], size: [8, 7], color: '#eef2ff', i: 1.5 },
      { pos: [8, 2, 7], size: [8, 7], color: '#dfe7ff', i: 1.3 },
      { pos: [0, 3, -10], size: [14, 0.7], color: '#ffffff', i: 8 },
    ],
  },
  neon: {
    room: '#0a0920',
    panels: [
      { pos: [0, 9, 0], size: [5, 3], color: '#ffffff', i: 7 },
      { pos: [-8, 3, 7], size: [8, 7], color: '#e8ecff', i: 2.4 },
      { pos: [8, 3, 7], size: [8, 7], color: '#e8ecff', i: 2.4 },
      { pos: [-9, 4, 0], size: [1, 10], color: '#ff3df5', i: 2.5 },
      { pos: [9, 4, 0], size: [1, 10], color: '#29f3ff', i: 2.5 },
    ],
  },
};

const envCache = new Map();
export function environmentFor(gl, name) {
  if (envCache.has(name)) return envCache.get(name);
  const spec = ENV_PANELS[name];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(spec.room);
  for (const p of spec.panels) {
    const color = new THREE.Color(p.color).multiplyScalar(p.i);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(...p.pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(gl);
  const tex = pmrem.fromScene(scene, 0.035, 0.1, 40).texture;
  pmrem.dispose();
  envCache.set(name, tex);
  return tex;
}

// ───────────────────────── geometry helpers ─────────────────────────

function roundedSquare(half, r) {
  const s = new THREE.Shape();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.quadraticCurveTo(half, -half, half, -half + r);
  s.lineTo(half, half - r);
  s.quadraticCurveTo(half, half, half - r, half);
  s.lineTo(-half + r, half);
  s.quadraticCurveTo(-half, half, -half, half - r);
  s.lineTo(-half, -half + r);
  s.quadraticCurveTo(-half, -half, -half + r, -half);
  return s;
}

/** A bevelled slab with its top at y = 0. Material 0 is the top, 1 the sides. */
function slabMesh(half, r, thickness, top, side) {
  const bevel = 0.035;
  const g = new THREE.ExtrudeGeometry(roundedSquare(half - bevel, r), {
    depth: thickness - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 12,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(thickness - bevel), 0);
  // Top-down UVs so the painted top lines up with world coordinates.
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + half) / (2 * half), 1 - (p.getZ(i) + half) / (2 * half));
  const m = new THREE.Mesh(g, [top, side]);
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

/** A metal band wrapped around a slab. */
function trimBand(half, r, height, y, mat) {
  const outer = roundedSquare(half + 0.018, r + 0.018);
  outer.holes.push(roundedSquare(half - 0.012, r));
  const g = new THREE.ExtrudeGeometry(outer, {
    depth: height, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 12,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Flat metal strips inlaid along the 3×3 grid. */
function gridStrips(width, height, mat) {
  const group = new THREE.Group();
  const seg = new THREE.BoxGeometry(3 + width, height, width);
  for (const v of [-1.5, -0.5, 0.5, 1.5]) {
    const a = new THREE.Mesh(seg, mat);
    a.position.set(0, height / 2 - 0.002, v);
    const b = new THREE.Mesh(seg, mat);
    b.position.set(v, height / 2 - 0.0015, 0);
    b.rotation.y = Math.PI / 2;
    a.receiveShadow = true;
    b.receiveShadow = true;
    group.add(a, b);
  }
  return group;
}

/** A thin square outline. */
function squareOutline(half, width, height, mat) {
  const g = new THREE.Group();
  for (const [x, z, len, rot] of [[0, -half, 2 * half + width, 0], [0, half, 2 * half + width, 0], [-half, 0, 2 * half + width, 1], [half, 0, 2 * half + width, 1]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, height, width), mat);
    m.position.set(x, height / 2, z);
    if (rot) m.rotation.y = Math.PI / 2;
    g.add(m);
  }
  return g;
}

/** An 8-pointed star (khatam) in raised metal. */
function rosette(r, mat, inner = 0.52) {
  const s = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const rr = i % 2 ? r * inner : r;
    if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** An ornate L-shaped metal bracket for the outer corners of a slab. */
function cornerBracket(half, mat) {
  const L = 0.5;
  const w = 0.11;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(L, 0);
  s.quadraticCurveTo(L + 0.07, w * 0.5, L, w);
  s.lineTo(w * 1.6, w);
  s.quadraticCurveTo(w, w, w, w * 1.6);
  s.lineTo(w, L);
  s.quadraticCurveTo(w * 0.5, L + 0.07, 0, L);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(Math.PI / 2);
  g.translate(-half, 0.018, -half);
  const group = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(g, mat);
    m.rotation.y = (i * Math.PI) / 2;
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

/** Small round studs where the grid lines cross. */
function addStuds(group, mat, r) {
  const stud = new THREE.CylinderGeometry(r, r * 1.08, 0.016, 32);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    for (const z of [-1.5, -0.5, 0.5, 1.5]) {
      const m = new THREE.Mesh(stud, mat);
      m.position.set(x, 0.009, z);
      m.castShadow = true;
      group.add(m);
    }
  }
}

const GOLD = '#ffcf6b';

const metal = (color, roughness = 0.24) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, envMapIntensity: 2.3 });

const pearl = () => new THREE.MeshPhysicalMaterial({
  color: '#fbf7ee', roughness: 0.22, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [120, 700],
});

function topMaterial(tex, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(tex.color, { aniso: 12 }),
    normalMap: opts.normal === false ? null : toTexture(normalFrom(tex.height, opts.normalStrength || 1.4, 1024), { color: false, aniso: 12 }),
    roughnessMap: toTexture(tex.rough, { color: false }),
    roughness: opts.roughness ?? 1,
    metalness: 0,
    clearcoat: opts.clearcoat ?? 0.7,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.16,
  });
}

/** Pedestals beside slab boards: the waiting pieces rest level with the board. */
function pedestalTemplate(thickness, rim, top) {
  const g = new THREE.Group();
  const lacquer = new THREE.MeshPhysicalMaterial({ color: '#060a1a', roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, thickness, 48), lacquer);
  body.position.y = -thickness / 2 - 0.001;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.33, 48), top);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.0015;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.02, 12, 64), rim);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.002;
  body.castShadow = true;
  body.receiveShadow = true;
  face.receiveShadow = true;
  g.add(body, face, ring);
  return g;
}

function tableMaterial(maps, repeat, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ map: toTexture(maps.color, { repeat }), roughness: 0.9, ...extra });
  if (maps.normal) {
    m.normalMap = toTexture(maps.normal, { color: false, repeat });
    m.normalScale = new THREE.Vector2(0.6, 0.6);
  }
  return m;
}

function table(mat, y) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

// ───────────────────────── the sets ─────────────────────────

const HALF = 2.0;

function buildWood(size) {
  const g = new THREE.Group();
  const T = 0.3;
  const gold = metal(GOLD, 0.22);
  const top = topMaterial(woodTop(size, HALF), { normalStrength: 2, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const side = new THREE.MeshPhysicalMaterial({ color: '#07090c', roughness: 0.3, clearcoat: 0.9 });
  g.add(slabMesh(HALF, 0.1, T, top, side));
  g.add(table(tableMaterial(fabricMaps('#0a3a2e', '#062a22', 3), 40), -T));
  g.add(trimBand(HALF, 0.1, 0.012, -0.03, gold));
  g.add(gridStrips(0.024, 0.01, gold));
  g.add(squareOutline(1.66, 0.01, 0.005, gold));
  addStuds(g, gold, 0.034);
  const velvet = fabricMaps('#0c3f33', '#072b24', 4);
  return { group: g, thickness: T, half: HALF, pedestal: pedestalTemplate(T, gold, tableMaterial(velvet, 2)) };
}

function buildMarble(size) {
  const g = new THREE.Group();
  const T = 0.28;
  const gold = metal(GOLD, 0.2);
  const top = topMaterial(marbleTop(size, HALF), { normal: false, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const side = new THREE.MeshPhysicalMaterial({ color: '#05070f', roughness: 0.2, clearcoat: 1 });
  g.add(slabMesh(HALF, 0.06, T, top, side));
  g.add(table(tableMaterial(lacquerMaps('#061038', '#0a1a56'), 3, { roughness: 0.46, metalness: 0 }), -T));
  g.add(trimBand(HALF, 0.06, 0.012, -0.03, gold));
  g.add(trimBand(HALF, 0.06, 0.012, -T + 0.03, gold));
  g.add(gridStrips(0.026, 0.01, gold));
  g.add(squareOutline(1.66, 0.01, 0.005, gold));
  addStuds(g, gold, 0.034);
  const velvet = fabricMaps('#101b48', '#0a1234', 6);
  return { group: g, thickness: T, half: HALF, pedestal: pedestalTemplate(T, gold, tableMaterial(velvet, 2)) };
}

function groundSet(theme) {
  const g = new THREE.Group();
  const E = 5;
  const tex = paintWorldTexture(THEMES[theme], E, 2048);
  const mat = new THREE.MeshStandardMaterial({
    map: toTexture(tex, { aniso: 12 }),
    normalMap: toTexture(normalFrom(tex, theme === 'sand' ? 0.9 : 0.8, 1400), { color: false, aniso: 12 }),
    roughness: 0.96,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * E, 2 * E), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  g.add(m);
  g.add(table(new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.96 }), -0.002)); // the night beyond the painted ground
  return { group: g, thickness: 0, half: 2.2, pedestal: null };
}

function buildNeon(size) {
  const g = new THREE.Group();
  const T = 0.22;
  const top = topMaterial(glassTop(size, HALF), { normal: false, clearcoat: 1, clearcoatRoughness: 0.03 });
  const side = new THREE.MeshPhysicalMaterial({ color: '#0a0d20', roughness: 0.1, metalness: 0.4, clearcoat: 1 });
  g.add(slabMesh(HALF, 0.14, T, top, side));
  g.add(table(tableMaterial(neonFloorMaps(), 7, { roughness: 0.42, metalness: 0.2 }), -T));
  const cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color('#29f3ff').multiplyScalar(1.5), toneMapped: false });
  const pink = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3df5').multiplyScalar(1.5), toneMapped: false });
  const edge = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3df5').multiplyScalar(1.5), toneMapped: false });
  const tube = new THREE.CylinderGeometry(0.017, 0.017, 3.03, 10);
  for (const v of [-1.5, -0.5, 0.5, 1.5]) {
    const a = new THREE.Mesh(tube, cyan);
    a.rotation.z = Math.PI / 2;
    a.position.set(0, 0.02, v);
    const b = new THREE.Mesh(tube, cyan);
    b.rotation.x = Math.PI / 2;
    b.position.set(v, 0.02, 0);
    g.add(a, b);
  }
  const rounded = (half, r, y) => {
    const pts = roundedSquare(half, r).getPoints(10).map((p) => new THREE.Vector3(p.x, y, p.y));
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.04);
  };
  g.add(new THREE.Mesh(new THREE.TubeGeometry(rounded(1.72, 0.14, 0.02), 320, 0.015, 8, true), pink));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(rounded(HALF + 0.005, 0.14, -T + 0.04), 320, 0.012, 8, true), edge));
  const rim = metal('#2a2f55', 0.2);
  const pad = new THREE.MeshPhysicalMaterial({ color: '#0a0d20', roughness: 0.1, clearcoat: 1 });
  const lights = [
    [new THREE.PointLight('#29f3ff', 2, 9), [-3.4, 2.4, 2.2]],
    [new THREE.PointLight('#ff3df5', 2, 9), [3.4, 2.4, -2.2]],
  ];
  for (const [l, p] of lights) {
    l.position.set(...p);
    g.add(l);
  }
  return {
    group: g,
    thickness: T,
    half: HALF,
    pedestal: pedestalTemplate(T, rim, pad),
    update(time) {
      const flicker = Math.sin(time * 37) > 0.985 ? 0.55 : 1;
      const breath = 1.45 + 0.2 * Math.sin(time * 2.1);
      cyan.color.set('#29f3ff').multiplyScalar(breath * flicker);
      pink.color.set('#ff3df5').multiplyScalar(1.5 + 0.2 * Math.sin(time * 1.3 + 1));
    },
  };
}

/** Builds (once) the set for a theme. `size` is the top texture resolution. */
const sets = new Map();
export function boardSet(id, size) {
  const key = `${id}:${size}`;
  if (sets.has(key)) return sets.get(key);
  const build = { wood: buildWood, marble: buildMarble, neon: buildNeon }[id];
  const set = build ? build(size) : groundSet(id);
  set.id = id;
  set.look = LOOKS[id];
  sets.set(key, set);
  return set;
}

