/**
 * A pinhole camera looking down at the board plane (z = 0) with a slight tilt.
 * World units: one board cell = 1; the board spans x, y ∈ [-1.5, 1.5];
 * +x right, +y towards the viewer, +z up.
 */
export class Camera {
  constructor({ tiltDeg = 30, distance = 9 } = {}) {
    this.tilt = (tiltDeg * Math.PI) / 180;
    this.sin = Math.sin(this.tilt);
    this.cos = Math.cos(this.tilt);
    this.D = distance;
    this.f = 100;
    this.cx = 0;
    this.cy = 0;
  }

  /** World → screen. `s` is the local scale (screen pixels per world unit). */
  project(x, y, z = 0) {
    const Z = this.D - y * this.sin - z * this.cos;
    const s = this.f / Z;
    return { x: this.cx + x * s, y: this.cy + (y * this.cos - z * this.sin) * s, s };
  }

  /** Screen → point on the board plane (z = 0). */
  unproject(sx, sy) {
    const v = (sy - this.cy) / this.f;
    const y = (v * this.D) / (this.cos + v * this.sin);
    const Z = this.D - y * this.sin;
    return { x: ((sx - this.cx) * Z) / this.f, y };
  }

  /** Chooses focal length and centre so every world point fits in the given screen rectangle. */
  fit(points, { x: rx = 0, y: ry = 0, width, height }, padX, padY = padX) {
    this.f = 1;
    this.cx = 0;
    this.cy = 0;
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
    const scale = Math.min((width - 2 * padX) / (maxX - minX), (height - 2 * padY) / (maxY - minY));
    this.f = scale;
    this.cx = rx + width / 2 - (scale * (minX + maxX)) / 2;
    this.cy = ry + height / 2 - (scale * (minY + maxY)) / 2;
  }
}
