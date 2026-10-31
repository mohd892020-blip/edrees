/**
 * Exact solver for Drees (used by the "expert" level, hints, reviews and the
 * campaign's puzzle generator).
 *
 * Movement phase: every position has exactly 3 pieces per player; with 9 free
 * cells that is 9!/(3!·3!·3!) = 1680 boards × 2 sides to move = 3360 states
 * (fewer when a variant seals cells). We solve them all with retrograde
 * analysis (backwards induction from the end):
 *   - WIN  if the side to move can complete a line now, or can move into a
 *          state that is LOSS for the opponent;
 *   - LOSS if the side to move has no legal move, or every move leads to a
 *          WIN state for the opponent;
 *   - everything left is a DRAW (perfect play cycles forever).
 * Distances (plies to the end with optimal play) are tracked so the engine
 * wins as fast as possible and loses as slowly as possible.
 *
 * Placement phase: the placement tree is tiny (the starter picks 3 cells, then
 * the other picks 3 of the remaining ones) and is solved by memoized minimax
 * with the exact movement values at the leaves.
 *
 * One solver exists per rule variant (see core/rules.js).
 */

import { BLOCKED, linesFor, canStep, normalizeVariant, variantKey, formsLine } from '../core/rules.js';

export const WIN = 1;
export const LOSS = -1;
export const DRAW = 0;

const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561];

/** Base-3 encoding of the pieces: empty/sealed = 0, player 0 = 1, player 1 = 2. */
export function encode(board) {
  let code = 0;
  for (let i = 0; i < 9; i++) if (board[i] === 0 || board[i] === 1) code += (board[i] + 1) * POW3[i];
  return code;
}

export function decode(code, blocked = []) {
  const board = new Array(9);
  for (let i = 0; i < 9; i++) {
    const d = Math.floor(code / POW3[i]) % 3;
    board[i] = blocked.includes(i) ? BLOCKED : d === 0 ? null : d - 1;
  }
  return board;
}

export class Solver {
  constructor(variant) {
    this.variant = normalizeVariant(variant);
    this.lines = linesFor(this.variant);
    this.blocked = this.variant.blocked;
    this.cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !this.blocked.includes(c));
    this.boards = [];
    this.index = new Int32Array(19683).fill(-1);
    this.#enumerate();
    this.#buildGraph();
    this.#retrograde();
    this.placementMemo = [new Map(), new Map()];
    this.expectMemo = [new Map(), new Map()];
  }

  #hasLine(board, p) {
    return this.lines.some((l) => board[l[0]] === p && board[l[1]] === p && board[l[2]] === p);
  }

  #enumerate() {
    const b = Array(9).fill(null);
    for (const c of this.blocked) b[c] = BLOCKED;
    const cells = this.cells;
    const rec = (k, n0, n1) => {
      if (k === cells.length) {
        if (n0 === 3 && n1 === 3) {
          this.index[encode(b)] = this.boards.length;
          this.boards.push(b.slice());
        }
        return;
      }
      for (const v of [null, 0, 1]) {
        const a = n0 + (v === 0 ? 1 : 0);
        const c = n1 + (v === 1 ? 1 : 0);
        if (a > 3 || c > 3) continue;
        if (6 - a - c > cells.length - k - 1) continue; // not enough cells left
        b[cells[k]] = v;
        rec(k + 1, a, c);
      }
      b[cells[k]] = null;
    };
    rec(0, 0, 0);
    this.lineMasks = this.boards.map((bd) => (this.#hasLine(bd, 0) ? 1 : 0) | (this.#hasLine(bd, 1) ? 2 : 0));
  }

  #buildGraph() {
    const n = this.boards.length;
    this.succ = new Array(n * 2); // next state id per move, -1 = immediate win
    this.moves = new Array(n * 2); // [from, to] per move
    for (let bi = 0; bi < n; bi++) {
      const board = this.boards[bi];
      const code = encode(board);
      for (const p of [0, 1]) {
        const succ = [];
        const moves = [];
        for (let f = 0; f < 9; f++) {
          if (board[f] !== p) continue;
          for (let t = 0; t < 9; t++) {
            if (board[t] !== null || !canStep(f, t, this.variant)) continue;
            const nb = this.index[code - (p + 1) * POW3[f] + (p + 1) * POW3[t]];
            succ.push(this.lineMasks[nb] & (1 << p) ? -1 : nb * 2 + (1 - p));
            moves.push([f, t]);
          }
        }
        this.succ[bi * 2 + p] = succ;
        this.moves[bi * 2 + p] = moves;
      }
    }
  }

  #retrograde() {
    const N = this.succ.length;
    const value = new Int8Array(N);
    const dist = new Int16Array(N);
    const fixed = new Uint8Array(N);
    for (let s = 0; s < N; s++) {
      if (this.succ[s].includes(-1)) {
        value[s] = WIN;
        dist[s] = 1;
        fixed[s] = 1;
      } else if (this.succ[s].length === 0) {
        value[s] = LOSS; // no legal move: the side to move loses
        dist[s] = 0;
        fixed[s] = 1;
      }
    }
    // Level-synchronous rounds so distances are exact (shortest win / longest loss).
    for (;;) {
      const updates = [];
      for (let s = 0; s < N; s++) {
        if (fixed[s]) continue;
        let bestWin = Infinity;
        let allWin = true;
        let longestLoss = 0;
        for (const t of this.succ[s]) {
          if (value[t] === LOSS) bestWin = Math.min(bestWin, dist[t] + 1);
          if (value[t] === WIN) longestLoss = Math.max(longestLoss, dist[t] + 1);
          else allWin = false;
        }
        if (bestWin < Infinity) updates.push(s, WIN, bestWin);
        else if (allWin) updates.push(s, LOSS, longestLoss);
      }
      if (!updates.length) break;
      for (let i = 0; i < updates.length; i += 3) {
        value[updates[i]] = updates[i + 1];
        dist[updates[i]] = updates[i + 2];
        fixed[updates[i]] = 1;
      }
    }
    this.value = value;
    this.dist = dist;
  }

  stateId(board, toMove) {
    const bi = this.index[encode(board)];
    if (bi < 0) throw new Error('Solver only knows full boards (3 + 3 pieces)');
    return bi * 2 + toMove;
  }

  /** Game-theoretic value for the side to move: {value: WIN|LOSS|DRAW, dist}. */
  evaluate(board, toMove) {
    const s = this.stateId(board, toMove);
    return { value: this.value[s], dist: this.dist[s] };
  }

  /**
   * Scores every move of `player` (higher is better for `player`):
   * immediate win 1000; forced win 500 - plies; draw 0..10 (bonus for
   * positions where many opponent replies are mistakes); forced loss -500 + plies.
   */
  rankMoves(board, player) {
    const s = this.stateId(board, player);
    const out = [];
    this.succ[s].forEach((t, i) => {
      const [from, to] = this.moves[s][i];
      let score;
      let outcome;
      let dist;
      if (t === -1) {
        score = 1000;
        outcome = WIN;
        dist = 1;
      } else if (this.value[t] === LOSS) {
        dist = this.dist[t] + 1;
        score = 500 - dist;
        outcome = WIN;
      } else if (this.value[t] === WIN) {
        dist = this.dist[t] + 1;
        score = -500 + dist;
        outcome = LOSS;
      } else {
        // Draw: prefer positions where the opponent has the most ways to go wrong.
        const replies = this.succ[t];
        let blunders = 0;
        for (const r of replies) if (r !== -1 && this.value[r] === WIN) blunders++;
        score = (10 * blunders) / replies.length;
        outcome = DRAW;
        dist = 0;
      }
      out.push({ from, to, score, outcome, dist });
    });
    return out;
  }

  /** Score of a fully placed board from the starter's point of view. */
  leafScore(code, starter) {
    const s = this.index[code] * 2 + starter;
    const v = this.value[s];
    if (v === WIN) return 100 - this.dist[s];
    if (v === LOSS) return -(100 - this.dist[s]);
    return 0;
  }

  /** Minimax over the placement tree; score from the starter's point of view. */
  placementScore(code, starter) {
    const memo = this.placementMemo[starter];
    const hit = memo.get(code);
    if (hit !== undefined) return hit;
    const { mover, children } = placementChildren(code, starter, this.variant);
    let result;
    if (mover === null) result = this.leafScore(code, starter);
    else {
      const scores = children.map((c) => this.placementScore(c.code, starter));
      result = mover === starter ? Math.max(...scores) : Math.min(...scores);
    }
    memo.set(code, result);
    return result;
  }

  /** Expected score if both sides placed uniformly at random (tie-breaker). */
  placementExpectation(code, starter) {
    const memo = this.expectMemo[starter];
    const hit = memo.get(code);
    if (hit !== undefined) return hit;
    const { mover, children } = placementChildren(code, starter, this.variant);
    const result =
      mover === null
        ? this.leafScore(code, starter)
        : children.reduce((acc, c) => acc + this.placementExpectation(c.code, starter), 0) / children.length;
    memo.set(code, result);
    return result;
  }

  /** Ranks every placement cell for `mover` (score from mover's point of view). */
  rankPlacements(board, starter, mover) {
    const code = encode(board);
    const sign = mover === starter ? 1 : -1;
    const out = [];
    for (let cell = 0; cell < 9; cell++) {
      if (board[cell] !== null || formsLine(board, mover, cell, this.variant)) continue;
      const child = code + (mover + 1) * POW3[cell];
      out.push({
        cell,
        score: sign * this.placementScore(child, starter),
        expect: sign * this.placementExpectation(child, starter),
      });
    }
    return out;
  }

  /** Value of the empty board for the toss winner (positive = starter wins). */
  openingValue(starter = 0) {
    return this.placementScore(0, starter);
  }
}

/** Shared helper: who places next and the legal resulting child codes. */
export function placementChildren(code, starter, variant) {
  const v = normalizeVariant(variant);
  const board = decode(code, v.blocked);
  let ns = 0;
  let no = 0;
  for (const v of board) {
    if (v === starter) ns++;
    else if (v === 0 || v === 1) no++;
  }
  if (ns === 3 && no === 3) return { mover: null, children: [] };
  const mover = ns < 3 ? starter : 1 - starter;
  const children = [];
  for (let cell = 0; cell < 9; cell++) {
    if (board[cell] === null && !formsLine(board, mover, cell, v)) children.push({ cell, code: code + (mover + 1) * POW3[cell] });
  }
  return { mover, children };
}

const solvers = new Map();
/** One lazily built solver per rule variant (each takes a few milliseconds). */
export function getSolver(variant) {
  const key = variantKey(variant);
  let s = solvers.get(key);
  if (!s) {
    s = new Solver(variant);
    solvers.set(key, s);
  }
  return s;
}
