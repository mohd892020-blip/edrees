import { describe, test, assert } from './harness.js';
import { applyAction, validateAction, legalActions, Phase, winningCells } from '../js/core/rules.js';
import { chooseAction } from '../js/ai/ai.js';
import { getSolver, encode, WIN, DRAW } from '../js/ai/solver.js';
import { CHAPTERS, ALL_STAGES, findStage, nextStageId } from '../js/campaign/stages.js';
import { buildStageState, puzzleAlive, stageSucceeded, starsFor, needsToss } from '../js/campaign/play.js';
import { emptyProgress, stageUnlocked, chapterUnlocked, recordStars, totalStars, currentStageId } from '../js/campaign/progress.js';
import { mulberry32 } from '../js/core/rng.js';

/** Plays a stage like the app does; the human uses `humanLevel`. */
function playStage(stage, chapter, { humanLevel = 'expert', seed = 1, starter = 0, firstMove = null } = {}) {
  let s = buildStageState(stage, chapter, starter);
  const rng = mulberry32(seed);
  let humanMoves = 0;
  let guard = 0;
  while (s.phase !== Phase.OVER) {
    let a;
    if (s.turn === 0) a = firstMove && humanMoves === 0 && s.phase === Phase.MOVEMENT ? firstMove : chooseAction(s, humanLevel, rng);
    else a = chooseAction(s, stage.opponent, rng);
    assert.ok(validateAction(s, a).ok, `illegal action in ${stage.id}`);
    s = applyAction(s, a);
    if (a.player === 0 && a.type === 'move') {
      humanMoves++;
      if (!puzzleAlive(stage, s, humanMoves)) return { success: false, failFast: true, state: s };
    }
    if (++guard > 400) throw new Error('stage did not end');
  }
  return { success: stageSucceeded(stage, s), state: s, humanMoves };
}

describe('campaign › content', () => {
  test('stage ids are unique and chained', () => {
    const ids = ALL_STAGES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(nextStageId('1-6'), '2-1');
    assert.equal(nextStageId(ids[ids.length - 1]), null);
    assert.equal(findStage('2-4').stage.setup.plies, 7);
  });

  test('every stage builds a valid opening state', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages) {
        for (const starter of needsToss(stage) ? [0, 1] : [0]) {
          const s = buildStageState(stage, chapter, starter);
          assert.ok(s.phase !== Phase.OVER, stage.id);
          assert.ok(legalActions(s).length > 0, stage.id);
        }
      }
    }
  });

  test('puzzles are exact forced wins of the announced length', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages.filter((s) => s.kind === 'puzzle')) {
        const s = buildStageState(stage, chapter);
        const { value, dist } = getSolver(chapter.variant).evaluate(s.board, 0);
        assert.equal(value, WIN, stage.id);
        assert.equal(dist, stage.setup.plies, stage.id);
        assert.equal((dist + 1) / 2, stage.goal.limit, `${stage.id} limit matches the puzzle length`);
      }
    }
  });

  test('defenses are drawn positions under an immediate threat', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages.filter((s) => s.kind === 'defense')) {
        const s = buildStageState(stage, chapter);
        assert.equal(getSolver(chapter.variant).evaluate(s.board, 0).value, DRAW, stage.id);
        assert.ok(winningCells(s.board, 1, chapter.variant).length > 0, stage.id);
      }
    }
  });

  test('placement challenges can be held but are easy to get wrong', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages.filter((s) => s.kind === 'placement')) {
        const s = buildStageState(stage, chapter);
        assert.equal(s.phase, Phase.PLACEMENT);
        assert.equal(s.turn, 0);
        const score = getSolver(chapter.variant).placementScore(encode(s.board), s.starter);
        assert.ok(score <= 0, `${stage.id}: a perfect reply must hold`);
      }
    }
  });

  test('the marble boss is a theoretical win for the human (second player)', () => {
    const { chapter, stage } = findStage('4-4');
    const s = buildStageState(stage, chapter);
    assert.equal(s.starter, 1);
    assert.ok(getSolver(chapter.variant).openingValue(1) < 0);
  });
});

describe('campaign › completable with perfect play', () => {
  test('puzzles, defenses, placements and bosses always succeed for a perfect player', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages.filter((s) => s.kind !== 'match')) {
        for (const starter of needsToss(stage) ? [0, 1] : [0]) {
          for (const seed of [1, 2, 3]) {
            const r = playStage(stage, chapter, { seed, starter });
            assert.ok(r.success, `${stage.id} failed (starter ${starter}, seed ${seed})`);
            if (stage.goal.limit) assert.ok(r.humanMoves <= stage.goal.limit, `${stage.id} too slow`);
          }
        }
      }
    }
  });

  test('match stages can be won by a strong player', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages.filter((s) => s.kind === 'match')) {
        let wins = 0;
        for (let seed = 1; seed <= 8; seed++) {
          if (playStage(stage, chapter, { seed, starter: seed % 2 }).success) wins++;
        }
        assert.ok(wins > 0, `${stage.id} never won`);
      }
    }
  });

  test('a wrong first move fails a puzzle immediately', () => {
    for (const chapter of CHAPTERS) {
      for (const stage of chapter.stages.filter((s) => s.kind === 'puzzle')) {
        const s = buildStageState(stage, chapter);
        const solver = getSolver(chapter.variant);
        const ranked = solver.rankMoves(s.board, 0);
        // Wrong = loses the win, or wins too slowly for the stage's move limit.
        const wrong = ranked.find((r) => r.outcome !== WIN || r.dist > stage.setup.plies);
        assert.ok(wrong, `${stage.id} has no wrong move`);
        const r = playStage(stage, chapter, { firstMove: { type: 'move', player: 0, from: wrong.from, to: wrong.to } });
        assert.ok(!r.success, `${stage.id} should fail after a wrong move`);
      }
    }
  });
});

describe('campaign › stars and progress', () => {
  const { stage } = findStage('1-1');
  const won = { phase: Phase.OVER, winner: 0, moveCount: 8 };

  test('stars: goal + no hint + bonus', () => {
    assert.equal(starsFor(stage, { success: true, hintsUsed: 0, final: won }), 3);
    assert.equal(starsFor(stage, { success: true, hintsUsed: 1, final: won }), 2);
    assert.equal(starsFor(stage, { success: true, hintsUsed: 0, final: { ...won, moveCount: 30 } }), 2);
    assert.equal(starsFor(stage, { success: false, final: won }), 0);
    const puzzle = findStage('1-2').stage;
    assert.equal(starsFor(puzzle, { success: true, attempt: 2, final: won }), 2);
  });

  test('stages unlock one after another, chapters after their boss', () => {
    const p = emptyProgress();
    assert.ok(stageUnlocked(p, 0, 0));
    assert.ok(!stageUnlocked(p, 0, 1));
    assert.ok(!chapterUnlocked(p, 1));
    assert.equal(currentStageId(p), '1-1');
    for (const s of CHAPTERS[0].stages) recordStars(p, s.id, 1);
    assert.ok(chapterUnlocked(p, 1));
    assert.ok(stageUnlocked(p, 1, 0));
    assert.equal(currentStageId(p), '2-1');
  });

  test('recordStars keeps the best result', () => {
    const p = emptyProgress();
    recordStars(p, '1-1', 2);
    recordStars(p, '1-1', 1);
    assert.equal(p.stars['1-1'], 2);
    assert.equal(totalStars(p), 2);
  });
});
