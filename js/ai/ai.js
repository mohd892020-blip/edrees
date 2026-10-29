/**
 * Computer opponents. `chooseAction(state, level)` is pure apart from the
 * injected RNG: it reads a game state and returns an action for the side to move.
 *
 *  easy   — mostly random; sometimes notices a win or a block.
 *  medium — wins if it can, blocks an immediate win, otherwise random.
 *  hard   — Minimax + Alpha-Beta, limited depth, heuristic evaluation.
 *  expert — perfect play from the fully solved game (retrograde analysis).
 *
 * Every level follows the rule variant stored in the state.
 */

import {
  Phase, ActionType, winningCells, winningMoves, opponent, linesFor, canStep, CLASSIC,
} from '../core/rules.js';
import { getSolver } from './solver.js';
import { rankMovesBySearch, rankPlacementsBySearch } from './search.js';
import { pick, argmaxAll } from '../core/rng.js';

export const LEVELS = Object.freeze(['easy', 'medium', 'hard', 'expert']);

const HARD_MOVE_DEPTH = 3;
const HARD_PLACEMENT_LEAF_DEPTH = 2;

const variantOf = (state) => (state.rules && state.rules.variant) || CLASSIC;

export function chooseAction(state, level, rng = Math.random) {
  if (state.phase === Phase.OVER) return null;
  const player = state.turn;
  const strategy = STRATEGIES[level] || STRATEGIES.medium;
  const v = variantOf(state);
  if (state.phase === Phase.PLACEMENT) {
    return { type: ActionType.PLACE, player, to: strategy.place(state, player, rng, v) };
  }
  const { from, to } = strategy.move(state, player, rng, v);
  return { type: ActionType.MOVE, player, from, to };
}

/**
 * The best action by perfect play, chosen deterministically (used for hints
 * and reviews): fastest win, slowest loss, and among draws the move that
 * leaves the opponent the most ways to go wrong.
 */
export function bestAction(state) {
  if (state.phase === Phase.OVER) return null;
  const player = state.turn;
  const solver = getSolver(variantOf(state));
  if (state.phase === Phase.PLACEMENT) {
    const ranked = solver.rankPlacements(state.board, state.starter, player);
    const best = argmaxAll(argmaxAll(ranked, (r) => r.score), (r) => r.expect)[0];
    return { type: ActionType.PLACE, player, to: best.cell };
  }
  const best = argmaxAll(solver.rankMoves(state.board, player), (r) => r.score)[0];
  return { type: ActionType.MOVE, player, from: best.from, to: best.to };
}

/** Warm up expensive tables ahead of time (e.g. while the menu is shown). */
export function prepare(level, variant = CLASSIC) {
  if (level === 'expert') getSolver(variant);
}

// ───────────────────────── helpers ─────────────────────────

function allMoves(board, player, v) {
  const out = [];
  for (let from = 0; from < 9; from++) {
    if (board[from] !== player) continue;
    for (let to = 0; to < 9; to++) if (board[to] === null && canStep(from, to, v)) out.push({ from, to });
  }
  return out;
}

function movedBoard(board, player, { from, to }) {
  const b = board.slice();
  b[from] = null;
  b[to] = player;
  return b;
}

function blockingMoves(board, player, v) {
  const threats = winningCells(board, opponent(player), v);
  if (!threats.length) return [];
  const blocks = allMoves(board, player, v).filter((m) => threats.includes(m.to));
  // Prefer blocks that do not open a fresh threat for the opponent.
  const solid = blocks.filter((m) => winningCells(movedBoard(board, player, m), opponent(player), v).length === 0);
  return solid.length ? solid : blocks;
}

function emptyList(board) {
  const out = [];
  board.forEach((v, i) => v === null && out.push(i));
  return out;
}

/** Empty cells that would give `player` two-in-a-line with the third cell free. */
function pairMakingCells(board, player, v) {
  const out = new Set();
  for (const line of linesFor(v)) {
    const own = line.filter((i) => board[i] === player).length;
    const free = line.filter((i) => board[i] === null);
    if (own === 1 && free.length === 2) free.forEach((c) => out.add(c));
  }
  return [...out];
}

// ───────────────────────── strategies ─────────────────────────

const STRATEGIES = {
  easy: {
    place(state, player, rng) {
      return pick(rng, emptyList(state.board));
    },
    move(state, player, rng, v) {
      const wins = winningMoves(state.board, player, v);
      if (wins.length && rng() < 0.35) return pick(rng, wins);
      const blocks = blockingMoves(state.board, player, v);
      if (blocks.length && rng() < 0.25) return pick(rng, blocks);
      return pick(rng, allMoves(state.board, player, v));
    },
  },

  medium: {
    place(state, player, rng, v) {
      const { board, starter } = state;
      const empty = emptyList(board);
      if (player !== starter) {
        // The starter moves first after placement: fill the cells it could win on.
        const danger = winningCells(board, starter, v).filter((c) => board[c] === null);
        if (danger.length) return pick(rng, danger);
      } else if (rng() < 0.6) {
        const pairs = pairMakingCells(board, player, v);
        if (pairs.length) return pick(rng, pairs);
      }
      return pick(rng, empty);
    },
    move(state, player, rng, v) {
      const wins = winningMoves(state.board, player, v);
      if (wins.length) return pick(rng, wins);
      const blocks = blockingMoves(state.board, player, v);
      if (blocks.length) return pick(rng, blocks);
      return pick(rng, allMoves(state.board, player, v));
    },
  },

  hard: {
    place(state, player, rng, v) {
      const ranked = rankPlacementsBySearch(state.board, state.starter, player, HARD_PLACEMENT_LEAF_DEPTH, v);
      return pick(rng, argmaxAll(ranked, (r) => r.score)).cell;
    },
    move(state, player, rng, v) {
      const ranked = rankMovesBySearch(state.board, player, HARD_MOVE_DEPTH, v);
      return pick(rng, argmaxAll(ranked, (r) => r.score));
    },
  },

  expert: {
    place(state, player, rng, v) {
      const ranked = getSolver(v).rankPlacements(state.board, state.starter, player);
      const best = argmaxAll(ranked, (r) => r.score);
      return pick(rng, argmaxAll(best, (r) => r.expect)).cell;
    },
    move(state, player, rng, v) {
      const ranked = getSolver(v).rankMoves(state.board, player);
      return pick(rng, argmaxAll(ranked, (r) => r.score));
    },
  },
};
