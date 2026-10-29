/**
 * Builds campaign starting positions straight from the exact solver, so every
 * puzzle has a guaranteed solution and every challenge is fair:
 *  - puzzles   : the human (player 0) to move with a forced win in exactly N plies;
 *  - defenses  : drawn positions where the opponent threatens to win and only
 *                few moves hold;
 *  - placements: the opponent (starter) has placed its three pieces and most of
 *                the human's replies lose against perfect play.
 * Candidates are deduplicated by board symmetry, sorted from hardest to easiest
 * and picked deterministically, so a stage always shows the same position.
 */
import { getSolver, encode, WIN, DRAW } from '../ai/solver.js';
import { normalizeVariant, winningCells, winningMoves, DIAGONALS, BLOCKED } from '../core/rules.js';

// The 8 symmetries of the square (they preserve rows, columns, diagonals and the centre).
const D4 = [
  (r, c) => [r, c], (r, c) => [c, 2 - r], (r, c) => [2 - r, 2 - c], (r, c) => [2 - c, r],
  (r, c) => [r, 2 - c], (r, c) => [2 - r, c], (r, c) => [c, r], (r, c) => [2 - c, 2 - r],
].map((f) => Array.from({ length: 9 }, (_, i) => {
  const [r, c] = f(Math.floor(i / 3), i % 3);
  return r * 3 + c;
}));

const sym = (v) => (v === null ? '.' : v === BLOCKED ? 'x' : String(v));

function canonical(board) {
  let best = null;
  for (const map of D4) {
    const b = Array(9);
    board.forEach((v, i) => {
      b[map[i]] = v;
    });
    const k = b.map(sym).join('');
    if (best === null || k < best) best = k;
  }
  return best;
}

const swapColours = (b) => b.map((v) => (v === 0 ? 1 : v === 1 ? 0 : v));
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const cache = new Map();
/** Every solved movement position with the human (0) to move, one per symmetry class. */
function humanToMove(solver) {
  if (cache.has(solver)) return cache.get(solver);
  const seen = new Map();
  solver.boards.forEach((board, bi) => {
    for (const p of [0, 1]) {
      const b = p === 0 ? board : swapColours(board);
      const key = canonical(b);
      if (!seen.has(key)) seen.set(key, { board: b, s: bi * 2 + p, key });
    }
  });
  const list = [...seen.values()].sort(byKey);
  cache.set(solver, list);
  return list;
}

const choose = (list, pick) => list[Math.min(pick, list.length - 1)];

/** A forced win for the human in exactly `plies` plies. */
export function puzzlePosition(variant, plies, pick = 0, { lineType = null } = {}) {
  const v = normalizeVariant(variant);
  const solver = getSolver(v);
  const candidates = [];
  for (const x of humanToMove(solver)) {
    if (solver.value[x.s] !== WIN || solver.dist[x.s] !== plies) continue;
    if (lineType === 'diagonal') {
      const wins = winningMoves(x.board, 0, v);
      const allDiagonal = wins.length && wins.every(({ from, to }) => {
        const b = x.board.slice();
        b[from] = null;
        b[to] = 0;
        return DIAGONALS.some((l) => l.every((c) => b[c] === 0));
      });
      if (!allDiagonal) continue;
    }
    const ranked = solver.rankMoves(x.board, 0);
    const top = Math.max(...ranked.map((r) => r.score));
    const solutions = ranked.filter((r) => r.score === top).length;
    if (solutions === ranked.length) continue; // every move works: not a puzzle
    candidates.push({
      ...x,
      solutions,
      winning: ranked.filter((r) => r.outcome === WIN).length,
      losing: ranked.filter((r) => r.outcome !== WIN).length,
      threats: winningCells(x.board, 1, v).length,
    });
  }
  // Hardest first: a single solution, few winning moves, and a scary opponent.
  candidates.sort((a, b) => a.solutions - b.solutions || a.winning - b.winning || b.threats - a.threats || byKey(a, b));
  if (!candidates.length) throw new Error(`no ${plies}-ply puzzle for this variant`);
  const c = choose(candidates, pick);
  return { board: c.board, turn: 0, solutions: c.solutions };
}

/** A drawn position where the opponent threatens to win and few moves hold. */
export function defensePosition(variant, pick = 0) {
  const v = normalizeVariant(variant);
  const solver = getSolver(v);
  const candidates = [];
  for (const x of humanToMove(solver)) {
    if (solver.value[x.s] !== DRAW) continue;
    const threats = winningCells(x.board, 1, v).length;
    if (!threats) continue;
    const replies = solver.succ[x.s];
    const safe = replies.filter((t) => t !== -1 && solver.value[t] !== WIN).length;
    candidates.push({ ...x, safe, total: replies.length, threats });
  }
  candidates.sort((a, b) => a.safe / a.total - b.safe / b.total || b.threats - a.threats || byKey(a, b));
  if (!candidates.length) throw new Error('no defensive position for this variant');
  const c = choose(candidates, pick);
  return { board: c.board, turn: 0, safe: c.safe };
}

function combos(cells, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) return void out.push(acc.slice());
    for (let i = start; i < cells.length; i++) {
      acc.push(cells[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

/** The opponent (starter, player 1) has placed; few of the human's replies hold. */
export function placementChallenge(variant, pick = 0) {
  const v = normalizeVariant(variant);
  const solver = getSolver(v);
  const cells = solver.cells;
  const seen = new Set();
  const candidates = [];
  for (const set of combos(cells, 3)) {
    const board = Array(9).fill(null);
    for (const c of v.blocked) board[c] = BLOCKED;
    for (const c of set) board[c] = 1;
    const key = canonical(board);
    if (seen.has(key)) continue;
    seen.add(key);
    const free = cells.filter((c) => !set.includes(c));
    let safe = 0;
    let total = 0;
    for (const reply of combos(free, 3)) {
      const leaf = board.slice();
      for (const c of reply) leaf[c] = 0;
      total++;
      if (solver.leafScore(encode(leaf), 1) <= 0) safe++;
    }
    if (safe > 0) candidates.push({ board, key, safe, total });
  }
  candidates.sort((a, b) => a.safe / a.total - b.safe / b.total || byKey(a, b));
  const c = choose(candidates, pick);
  return { board: c.board, starter: 1, safe: c.safe, total: c.total };
}
