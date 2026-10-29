/**
 * Stage logic (pure): opening state, puzzle fail-fast check, success and stars.
 */
import { createGame, createPosition, Phase, DEFAULT_MAX_MOVES } from '../core/rules.js';
import { getSolver, LOSS } from '../ai/solver.js';
import { puzzlePosition, defensePosition, placementChallenge } from './generator.js';

export function stageOptions(stage, chapter) {
  return {
    variant: chapter.variant,
    maxMoves: stage.goal.type === 'survive' ? stage.goal.moves : DEFAULT_MAX_MOVES,
  };
}

export const needsToss = (stage) => stage.setup.type === 'toss';

/** The opening state of a stage. `starter` only matters for toss stages. */
export function buildStageState(stage, chapter, starter = 0) {
  const opts = stageOptions(stage, chapter);
  const s = stage.setup;
  switch (s.type) {
    case 'toss':
      return createGame({ ...opts, starter });
    case 'fixed':
      return createGame({ ...opts, starter: s.starter });
    case 'puzzle': {
      const p = puzzlePosition(chapter.variant, s.plies, s.pick, { lineType: s.lineType });
      return createPosition({ ...opts, board: p.board, starter: 0, turn: 0 });
    }
    case 'defense': {
      const p = defensePosition(chapter.variant, s.pick);
      return createPosition({ ...opts, board: p.board, starter: 0, turn: 0 });
    }
    case 'placement': {
      const p = placementChallenge(chapter.variant, s.pick);
      return createPosition({ ...opts, board: p.board, starter: p.starter });
    }
    default:
      throw new Error(`unknown stage setup ${s.type}`);
  }
}

/**
 * In move-limited puzzles, checked right after each human move: can the human
 * still force a win within the moves left? (The opponent defends perfectly.)
 */
export function puzzleAlive(stage, state, humanMoves) {
  const limit = stage.goal.limit;
  if (!limit || state.phase !== Phase.MOVEMENT || state.turn !== 1) return true;
  const { value, dist } = getSolver(state.rules.variant).evaluate(state.board, 1);
  return value === LOSS && dist / 2 <= limit - humanMoves;
}

export function stageSucceeded(stage, final) {
  return stage.goal.type === 'win' ? final.winner === 0 : final.phase === Phase.OVER && final.winner !== 1;
}

/** 1 star for the goal, 1 for not using hints, 1 for the stage's bonus. */
export function starsFor(stage, { success, hintsUsed = 0, attempt = 1, final }) {
  if (!success) return 0;
  let stars = 1;
  if (hintsUsed === 0) stars++;
  const b = stage.bonus || {};
  if (b.type === 'firstTry' && attempt === 1) stars++;
  else if (b.type === 'par' && final.winner === 0 && final.moveCount <= b.moves) stars++;
  else if (b.type === 'win' && final.winner === 0) stars++;
  return stars;
}
