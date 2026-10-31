/**
 * Camera rig for the 3D world. Game coordinates stay the same as everywhere
 * else (+x right, +y towards the viewer, +z up); Three.js uses y for up, so a
 * game point (x, y, z) lives at (x, z, y) in the scene.
 *
 * project/unproject keep the interface of the 2D camera, so input handling
 * and drag-and-drop work unchanged.
 */
import * as THREE from 'three';

const RAD = Math.PI / 180;
const v = new THREE.Vector3();

export const toScene = (x, y, z = 0) => new THREE.Vector3(x, z, y);

export class CameraRig {
  constructor() {
    this.cam = new THREE.PerspectiveCamera(26, 1, 0.1, 120);
    this.w = 1;
    this.h = 1;
    this.pose = { az: 0, el: 58 * RAD, radius: 12, tx: 0, ty: 0, tz: 0, ox: 0, oy: 0 };
    this.sway = { x: 0, y: 0 }; // small parallax offsets
    this.cos = 0.85;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.ndc = new THREE.Vector2();
    this.apply();
  }

  setViewport(w, h) {
    this.w = w;
    this.h = h;
    this.cam.aspect = w / h;
    this.apply();
  }

  /** Positions the camera from a pose: orbit around a target plus a screen shift. */
  apply(pose = this.pose) {
    const { az, el, radius, tx, ty, tz, ox, oy } = pose;
    const a = az + this.sway.x;
    const e = el + this.sway.y;
    const c = this.cam;
    c.position.set(
      tx + radius * Math.cos(e) * Math.sin(a),
      ty + radius * Math.sin(e),
      tz + radius * Math.cos(e) * Math.cos(a),
    );
    c.lookAt(tx, ty, tz);
    c.setViewOffset(this.w, this.h, ox, oy, this.w, this.h);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.cos = Math.sin(e);
  }

  /** World → canvas pixels. `s` is the local scale (pixels per world unit). */
  project(x, y, z = 0) {
    v.set(x, z, y).applyMatrix4(this.cam.matrixWorldInverse);
    const depth = -v.z;
    const s = this.h / (2 * Math.tan((this.cam.fov * RAD) / 2) * depth);
    v.applyMatrix4(this.cam.projectionMatrix);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h, s };
  }

  /** Canvas pixels → point on the board plane. */
  unproject(sx, sy) {
    this.ndc.set((sx / this.w) * 2 - 1, 1 - (sy / this.h) * 2);
    this.ray.setFromCamera(this.ndc, this.cam);
    const p = this.ray.ray.intersectPlane(this.plane, this.hit);
    return p ? { x: p.x, y: p.z } : { x: 1e6, y: 1e6 };
  }

  /**
   * Pose that fits all game-space points inside a screen rectangle: finds the
   * closest camera distance that still fits, then shifts the view to centre them.
   */
  fit(points, rect, pad, base) {
    const test = { ...this.pose, ...base, ox: 0, oy: 0 };
    const measure = (radius) => {
      test.radius = radius;
      this.apply(test);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, y, z = 0] of points) {
        const p = this.project(x, y, z);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      return { minX, maxX, minY, maxY };
    };
    let lo = 3;
    let hi = 60;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      const b = measure(mid);
      const fits = b.maxX - b.minX <= rect.width - 2 * pad && b.maxY - b.minY <= rect.height - 2 * pad;
      if (fits) hi = mid;
      else lo = mid;
    }
    const b = measure(hi);
    const pose = {
      ...test,
      radius: hi,
      ox: (b.minX + b.maxX) / 2 - (rect.x + rect.width / 2),
      oy: (b.minY + b.maxY) / 2 - (rect.y + rect.height / 2),
    };
    this.apply();
    return pose;
  }
}
