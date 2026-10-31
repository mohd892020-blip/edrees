/**
 * Depth-limited Minimax (negamax form) with Alpha-Beta pruning and a static
 * evaluation — the engine behind the "hard" level. Works for every rule variant.
 */

import {
  winningCells, opponent, linesFor, canStep, normalizeVariant, variantKey, hasLegalMove, formsLine,
} from '../core/rules.js';
import { encode, placementChildren, decode } from './solver.js';

export const WIN_SCORE = 10000;

/** Static evaluation from the point of view of `player`, who is to move. */
export function evaluate(board, player, variant) {
  const v = normalizeVariant(variant);
  const opp = opponent(player);
  if (!hasLegalMove(board, player, v)) return -WIN_SCORE / 2; // stuck: loses now
  const mine = winningCells(board, player, v).length;
  if (mine > 0) return WIN_SCORE / 2; // we complete a line on this move
  const theirs = winningCells(board, opp, v).length;
  if (theirs >= 2) return -WIN_SCORE / 4; // a double threat cannot be fully blocked

  let score = theirs === 1 ? -60 : 0;
  for (const line of linesFor(v)) {
    let own = 0;
    let other = 0;
    for (const i of line) {
      if (board[i] === player) own++;
      else if (board[i] === opp) other++;
    }
    if (other === 0) score += own === 2 ? 22 : own === 1 ? 4 : 0;
    if (own === 0) score -= other === 2 ? 26 : other === 1 ? 4 : 0;
  }
  return score;
}

function hasLineThrough(board, player, cell, lines) {
  for (const line of lines) {
    if (!line.includes(cell)) continue;
    if (board[line[0]] === player && board[line[1]] === player && board[line[2]] === player) return true;
  }
  return false;
}

function orderedMoves(board, player, v) {
  const threatsToBlock = winningCells(board, opponent(player), v);
  const myWins = winningCells(board, player, v);
  const moves = [];
  for (let from = 0; from < 9; from++) {
    if (board[from] !== player) continue;
    for (let to = 0; to < 9; to++) {
      if (board[to] !== null || !canStep(from, to, v)) continue;
      let prio = 0;
      if (myWins.includes(to)) prio += 100;
      if (threatsToBlock.includes(to)) prio += 10;
      moves.push({ from, to, prio });
    }
  }
  moves.sort((a, b) => b.prio - a.prio);
  return moves;
}

/** Negamax with alpha-beta. Returns a score from `player`'s point of view. */
export function negamax(board, player, depth, alpha, beta, ply = 0, variant = undefined) {
  const v = normalizeVariant(variant);
  if (depth === 0) return evaluate(board, player, v);
  const moves = orderedMoves(board, player, v);
  if (!moves.length) return -WIN_SCORE + ply; // no legal move loses
  const lines = linesFor(v);
  let best = -Infinity;
  for (const { from, to } of moves) {
    board[from] = null;
    board[to] = player;
    let score;
    if (hasLineThrough(board, player, to, lines)) score = WIN_SCORE - ply;
    else score = -negamax(board, opponent(player), depth - 1, -beta, -alpha, ply + 1, v);
    board[to] = null;
    board[from] = player;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Scores every root move with a full window (so ties are real ties). */
export function rankMovesBySearch(board, player, depth, variant) {
  const v = normalizeVariant(variant);
  const lines = linesFor(v);
  const b = board.slice();
  return orderedMoves(b, player, v).map(({ from, to }) => {
    b[from] = null;
    b[to] = player;
    const score = hasLineThrough(b, player, to, lines)
      ? WIN_SCORE
      : -negamax(b, opponent(player), depth - 1, -Infinity, Infinity, 1, v);
    b[to] = null;
    b[from] = player;
    return { from, to, score };
  });
}

const placementMemo = new Map();

/**
 * Placement tree minimax where the leaves (all 6 pieces down, starter to move)
 * are scored by a shallow alpha-beta search instead of the exact solution.
 */
function heuristicPlacementScore(code, starter, leafDepth, v) {
  const key = `${variantKey(v)}:${starter}:${leafDepth}:${code}`;
  const hit = placementMemo.get(key);
  if (hit !== undefined) return hit;
  const { mover, children } = placementChildren(code, starter, v);
  let result;
  if (mover === null) {
    result = negamax(decode(code, v.blocked), starter, leafDepth, -Infinity, Infinity, 0, v);
  } else {
    const scores = children.map((c) => heuristicPlacementScore(c.code, starter, leafDepth, v));
    result = mover === starter ? Math.max(...scores) : Math.min(...scores);
  }
  placementMemo.set(key, result);
  return result;
}

export function rankPlacementsBySearch(board, starter, mover, leafDepth, variant) {
  const v = normalizeVariant(variant);
  const code = encode(board);
  const sign = mover === starter ? 1 : -1;
  const out = [];
  for (let cell = 0; cell < 9; cell++) {
    if (board[cell] !== null || formsLine(board, mover, cell, v)) continue;
    const child = code + (mover + 1) * 3 ** cell;
    out.push({ cell, score: sign * heuristicPlacementScore(child, starter, leafDepth, v) });
  }
  return out;
}
