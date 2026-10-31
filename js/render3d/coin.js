/**
 * The toss coin: real metal with faces embossed through normal maps. The gold
 * side belongs to the local player and the silver side to the opponent.
 */
import * as THREE from 'three';
import { toTexture, normalFrom } from './surfaces.js';
import { makeCanvas } from '../render/texture.js';

const TAU = Math.PI * 2;
export const COIN_R = 0.72;
const COIN_H = 0.1;

function star8(x, cx, cy, r, inner) {
  x.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const rr = i % 2 ? r * inner : r;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
}

/** Height map of one coin face: rim, reeding, stars and the player's name. */
function faceHeight(name, size = 1024) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const m = size / 2;
  x.fillStyle = '#6a6a6a';
  x.fillRect(0, 0, size, size);
  x.translate(m, m);
  // Outer rim.
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.arc(0, 0, m, 0, TAU);
  x.arc(0, 0, m * 0.88, 0, TAU, true);
  x.fill();
  // Beaded ring.
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    x.beginPath();
    x.arc(Math.cos(a) * m * 0.82, Math.sin(a) * m * 0.82, m * 0.016, 0, TAU);
    x.fill();
  }
  // Engraved circle.
  x.strokeStyle = '#ffffff';
  x.lineWidth = m * 0.012;
  x.beginPath();
  x.arc(0, 0, m * 0.75, 0, TAU);
  x.stroke();
  // Rays and a star above the name.
  x.globalAlpha = 0.1;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    x.lineWidth = m * 0.008;
    x.beginPath();
    x.moveTo(Math.cos(a) * m * 0.3, Math.sin(a) * m * 0.3);
    x.lineTo(Math.cos(a) * m * 0.72, Math.sin(a) * m * 0.72);
    x.stroke();
  }
  x.globalAlpha = 1;
  star8(x, 0, -m * 0.4, m * 0.17, 0.5);
  x.fill();
  // The name.
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let fs = m * 0.36;
  const font = (s) => `700 ${s}px "Reem Kufi", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif`;
  x.font = font(fs);
  while (x.measureText(name).width > m * 1.3 && fs > 20) {
    fs -= 4;
    x.font = font(fs);
  }
  x.fillText(name, 0, m * 0.14);
  // Flourish under the name.
  x.lineWidth = m * 0.012;
  x.beginPath();
  x.moveTo(-m * 0.34, m * 0.46);
  x.quadraticCurveTo(0, m * 0.56, m * 0.34, m * 0.46);
  x.stroke();
  return c;
}

function faceMaterial(color, height) {
  const tone = makeCanvas(512, 512);
  const t = tone.getContext('2d');
  t.filter = 'contrast(1.25) brightness(1.5)';
  t.drawImage(height, 0, 0, 512, 512);
  return new THREE.MeshStandardMaterial({
    color,
    map: toTexture(tone),
    normalMap: toTexture(normalFrom(height, 2.6, 1024), { color: false, aniso: 12 }),
    normalScale: new THREE.Vector2(1.1, 1.1),
    metalness: 1,
    roughness: 0.25,
    envMapIntensity: 2.3,
  });
}

function edgeMaterial() {
  const c = makeCanvas(1024, 16);
  const x = c.getContext('2d');
  for (let i = 0; i < 128; i++) {
    x.fillStyle = i % 2 ? '#ffffff' : '#555555';
    x.fillRect(i * 8, 0, 8, 16);
  }
  return new THREE.MeshStandardMaterial({
    color: '#f2d58f',
    normalMap: toTexture(normalFrom(c, 2.2), { color: false }),
    metalness: 1,
    roughness: 0.3,
  });
}

export class Coin3D {
  constructor(scene) {
    this.group = new THREE.Group();
    this.side = edgeMaterial();
    this.top = new THREE.MeshStandardMaterial({ color: '#ffcf6b', metalness: 1, roughness: 0.3 });
    this.bottom = new THREE.MeshStandardMaterial({ color: '#dfe4ec', metalness: 1, roughness: 0.3 });
    const geo = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 96, 1);
    // Cap UVs: the top reads upright when flat, the bottom after a half turn around x.
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const ny = nor.getY(i);
      if (Math.abs(ny) < 0.5) continue;
      uv.setXY(i, pos.getX(i) / (2 * COIN_R) + 0.5, (ny > 0 ? -pos.getZ(i) : pos.getZ(i)) / (2 * COIN_R) + 0.5);
    }
    this.mesh = new THREE.Mesh(geo, [this.side, this.top, this.bottom]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.visible = false;
    scene.add(this.group);
    this.named = null;
  }

  setNames(a, b) {
    const key = `${a}|${b}`;
    if (this.named === key) return;
    this.named = key;
    this.mesh.material[1] = faceMaterial('#ffcf6b', faceHeight(a));
    this.mesh.material[2] = faceMaterial('#e3e7ee', faceHeight(b));
  }
}

export const COIN_REST = COIN_H / 2 + 0.03;
