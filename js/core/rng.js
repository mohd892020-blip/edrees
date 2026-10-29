/**
 * Small deterministic RNG helpers (no DOM, usable everywhere).
 */

/** Mulberry32 — fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng, n) => Math.floor(rng() * n);

export const pick = (rng, arr) => arr[randInt(rng, arr.length)];

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Returns every element of `items` whose score equals the maximum score. */
export function argmaxAll(items, score) {
  let best = -Infinity;
  let out = [];
  for (const it of items) {
    const s = score(it);
    if (s > best + 1e-9) {
      best = s;
      out = [it];
    } else if (Math.abs(s - best) <= 1e-9) {
      out.push(it);
    }
  }
  return out;
}
