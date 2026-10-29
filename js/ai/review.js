/**
 * Post-game review: replays a finished game and grades every action of one
 * player against perfect play (exact values from the solver).
 *
 * Verdicts:
 *  best       — keeps the best outcome the position allowed;
 *  slow       — still winning, but the win now takes longer;
 *  missed-win — the position was a forced win and became a draw;
 *  blunder    — turned a win or a draw into a forced loss.
 * The solver ignores the repetition / move-limit draws, so this measures
 * the theoretical quality of each decision.
 */
import { Phase, ActionType, applyAction, CLASSIC } from '../core/rules.js';
import { getSolver, encode, WIN, LOSS } from './solver.js';
import { bestAction } from './ai.js';

const variantOf = (state) => (state.rules && state.rules.variant) || CLASSIC;

/** Exact outcome for `player`: v = 1 win / 0 draw / -1 loss, d = plies to the end. */
export function outcomeFor(state, player) {
  if (state.phase === Phase.OVER) {
    return { v: state.winner === null ? 0 : state.winner === player ? 1 : -1, d: 0 };
  }
  const solver = getSolver(variantOf(state));
  if (state.phase === Phase.PLACEMENT) {
    const sc = solver.placementScore(encode(state.board), state.starter);
    const v = Math.sign(sc) * (player === state.starter ? 1 : -1);
    return { v, d: sc === 0 ? 0 : 100 - Math.abs(sc) };
  }
  const { value, dist } = solver.evaluate(state.board, state.turn);
  const v = value === WIN ? 1 : value === LOSS ? -1 : 0;
  return { v: state.turn === player ? v : -v, d: dist };
}

export function gradeAction(state, action) {
  const player = action.player;
  const before = outcomeFor(state, player);
  const next = applyAction(state, action);
  const after = outcomeFor(next, player);
  let verdict = 'best';
  if (after.v < before.v) verdict = before.v === 1 && after.v === 0 ? 'missed-win' : 'blunder';
  else if (before.v === 1 && state.phase === Phase.MOVEMENT && next.phase !== Phase.OVER && after.d > before.d - 1) {
    verdict = 'slow';
  }
  return { verdict, before: before.v, after: after.v, next };
}

/**
 * Grades every action of `player` in a game that started at `initial`.
 * Returns { items, summary }; each item has the board before the action,
 * the action, its verdict and (when not best) the best alternative.
 */
export function reviewGame(initial, actions, player = 0) {
  const items = [];
  let state = initial;
  let index = 0;
  for (const action of actions) {
    if (action.player === player) {
      const { verdict, before, after, next } = gradeAction(state, action);
      items.push({
        index: ++index,
        phase: state.phase,
        board: state.board.slice(),
        action,
        verdict,
        before,
        after,
        best: verdict === 'best' ? null : bestAction(state),
      });
      state = next;
    } else {
      state = applyAction(state, action);
    }
  }
  const count = (k) => items.filter((i) => i.verdict === k).length;
  return {
    items,
    summary: {
      total: items.length,
      best: count('best'),
      slow: count('slow'),
      missedWins: count('missed-win'),
      blunders: count('blunder'),
    },
  };
}

export const isPlacement = (action) => action.type === ActionType.PLACE;
