/**
 * Tiny dependency-free test harness that runs both in the browser
 * (tests/index.html) and in Node (`node tests/run.js`).
 */

const registry = [];
let currentSuite = '';

export function describe(name, fn) {
  const prev = currentSuite;
  currentSuite = prev ? `${prev} › ${name}` : name;
  fn();
  currentSuite = prev;
}

export function test(name, fn) {
  registry.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

const show = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k]));
}

export const assert = {
  ok(value, msg = 'expected truthy value') {
    if (!value) throw new AssertionError(msg);
  },
  equal(actual, expected, msg) {
    if (!Object.is(actual, expected)) {
      throw new AssertionError(msg || `expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  notEqual(actual, expected, msg) {
    if (Object.is(actual, expected)) throw new AssertionError(msg || `did not expect ${show(actual)}`);
  },
  deepEqual(actual, expected, msg) {
    if (!deepEq(actual, expected)) {
      throw new AssertionError(msg || `expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  throws(fn, check, msg) {
    try {
      fn();
    } catch (err) {
      if (check && !check(err)) throw new AssertionError(msg || `unexpected error: ${err.message}`);
      return err;
    }
    throw new AssertionError(msg || 'expected function to throw');
  },
};

export async function run({ report = () => {} } = {}) {
  const results = [];
  for (const t of registry) {
    const t0 = (globalThis.performance || Date).now();
    try {
      await t.fn();
      results.push({ name: t.name, ok: true, ms: (globalThis.performance || Date).now() - t0 });
    } catch (err) {
      results.push({ name: t.name, ok: false, error: err, ms: (globalThis.performance || Date).now() - t0 });
    }
    report(results[results.length - 1]);
  }
  const failed = results.filter((r) => !r.ok).length;
  return { total: results.length, passed: results.length - failed, failed, results };
}
