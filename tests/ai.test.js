import { describe, test, assert } from './harness.js';
import { createGame, applyAction, validateAction, legalActions, Phase, winningCells, replay } from '../js/core/rules.js';
import { chooseAction, LEVELS } from '../js/ai/ai.js';
import { getSolver, encode, WIN, LOSS, DRAW } from '../js/ai/solver.js';
import { mulberry32 } from '../js/core/rng.js';

const place = (player, to) => ({ type: 'place', player, to });
const move = (player, from, to) => ({ type: 'move', player, from, to });

/** Plays one full game; `levels[p]` is a level name or 'random'. Returns the final state. */
function playGame(levels, starter, rng, onAction) {
  let s = createGame({ starter });
  let guard = 0;
  while (s.phase !== Phase.OVER) {
    const lvl = levels[s.turn];
    const action = lvl === 'random' ? randomAction(s, rng) : chooseAction(s, lvl, rng);
    assert.ok(validateAction(s, action).ok, `${lvl} produced an illegal action ${JSON.stringify(action)}`);
    const next = applyAction(s, action);
    if (onAction) onAction(s, action, next);
    s = next;
    if (++guard > 500) throw new Error('game did not terminate');
  }
  return s;
}

function randomAction(s, rng) {
  const acts = legalActions(s);
  return acts[Math.floor(rng() * acts.length)];
}

describe('solver', () => {
  const solver = getSolver();

  test('enumerates every movement position (1680 boards, 3360 states)', () => {
    assert.equal(solver.boards.length, 1680);
    assert.equal(solver.value.length, 3360);
  });

  test('a position with an immediate win is WIN in 1', () => {
    // 0 0 . / 1 1 . / 0 1 .
    const board = [0, 0, null, 1, 1, null, 0, 1, null];
    assert.deepEqual(solver.evaluate(board, 0), { value: WIN, dist: 1 });
    assert.deepEqual(solver.evaluate(board, 1), { value: WIN, dist: 1 });
  });

  test('a double threat for the opponent is a LOSS', () => {
    // 0 . .
    // 1 1 .      player 1 (3,4,7) threatens cell 5 (row) and cell 1 (column)
    // 0 1 0      player 0 can block only one of them
    const board = [0, null, null, 1, 1, null, 0, 1, 0];
    assert.deepEqual(winningCells(board, 1).sort(), [1, 5]);
    assert.equal(winningCells(board, 0).length, 0);
    assert.equal(solver.evaluate(board, 0).value, LOSS);
  });

  test('values are consistent with their successors', () => {
    for (let s = 0; s < solver.succ.length; s++) {
      const succ = solver.succ[s];
      const v = solver.value[s];
      const hasImmediate = succ.includes(-1);
      const anyLoss = succ.some((t) => t !== -1 && solver.value[t] === LOSS);
      const allWin = succ.every((t) => t !== -1 && solver.value[t] === WIN);
      if (v === WIN) assert.ok(hasImmediate || anyLoss, `state ${s} WIN without reason`);
      if (v === LOSS) assert.ok(!hasImmediate && allWin, `state ${s} LOSS without reason`);
      if (v === DRAW) assert.ok(!hasImmediate && !anyLoss && !allWin, `state ${s} DRAW inconsistent`);
    }
  });

  test('opening value is computed for both toss outcomes', () => {
    const v0 = solver.openingValue(0);
    const v1 = solver.openingValue(1);
    assert.equal(v0, v1, 'the game is symmetric between players');
    globalThis.__dreesOpeningValue = v0;
  });
});

describe('AI levels', () => {
  test('every level only ever plays legal actions (both seats, both starters)', () => {
    const rng = mulberry32(7);
    for (const lvl of LEVELS) {
      for (const starter of [0, 1]) {
        for (let g = 0; g < 6; g++) {
          playGame([lvl, 'random'], starter, rng);
          playGame(['random', lvl], starter, rng);
        }
      }
    }
  });

  test('medium and above always take an immediate win', () => {
    const s = replay(
      [place(0, 0), place(0, 1), place(0, 6), place(1, 3), place(1, 4), place(1, 8)],
      { starter: 0 },
    );
    // 0 0 . / 1 1 . / 0 . 1  — player 0 wins with 6 -> 2
    for (const lvl of ['medium', 'hard', 'expert']) {
      for (let i = 0; i < 5; i++) {
        const a = chooseAction(s, lvl, mulberry32(i));
        const next = applyAction(s, a);
        assert.equal(next.winner, 0, `${lvl} missed the win`);
      }
    }
  });

  test('medium blocks a single immediate threat when it cannot win', () => {
    // p0: 0, 1, 8   p1: 3, 6, 7 → p0 threatens cell 2; p1 has no immediate win (col 0 needs 0).
    const s = replay(
      [place(1, 3), place(1, 6), place(1, 7), place(0, 0), place(0, 1), place(0, 8)],
      { starter: 1 },
    );
    // Hand the move to player 1 (starter) – it must block 2.
    assert.deepEqual(winningCells(s.board, 0), [2]);
    for (let i = 0; i < 10; i++) {
      const a = chooseAction(s, 'medium', mulberry32(i));
      assert.equal(a.to, 2, 'medium should block cell 2');
    }
  });

  test('expert never lets the game-theoretic value drop (vs random, medium, hard)', () => {
    const solver = getSolver();
    const rng = mulberry32(2024);
    const valueFor = (state, player) => {
      // Placement: exact minimax score; movement: exact solved value.
      if (state.phase === Phase.PLACEMENT) {
        const sc = solver.placementScore(encode(state.board), state.starter);
        const v = Math.sign(sc);
        return player === state.starter ? v : -v;
      }
      const { value } = solver.evaluate(state.board, state.turn);
      return state.turn === player ? value : -value;
    };
    let games = 0;
    for (const opp of ['random', 'easy', 'medium', 'hard']) {
      for (const expertSeat of [0, 1]) {
        for (const starter of [0, 1]) {
          for (let g = 0; g < 5; g++) {
            const levels = expertSeat === 0 ? ['expert', opp] : [opp, 'expert'];
            const final = playGame(levels, starter, rng, (prev, action, next) => {
              if (action.player !== expertSeat || next.phase === Phase.OVER) return;
              const before = valueFor(prev, expertSeat);
              const after = valueFor(next, expertSeat);
              assert.ok(after >= before, `expert dropped value ${before} -> ${after}`);
            });
            const startValue = Math.sign(solver.openingValue(starter)) * (expertSeat === starter ? 1 : -1);
            if (startValue >= 0) assert.notEqual(final.winner, 1 - expertSeat, 'expert lost a non-lost game');
            games++;
          }
        }
      }
    }
    assert.ok(games === 80);
  });

  test('expert vs expert ends exactly as the solved opening value predicts', () => {
    const solver = getSolver();
    for (const starter of [0, 1]) {
      const v = Math.sign(solver.openingValue(starter));
      for (let g = 0; g < 3; g++) {
        const final = playGame(['expert', 'expert'], starter, mulberry32(100 + g));
        if (v > 0) assert.equal(final.winner, starter);
        else if (v < 0) assert.equal(final.winner, 1 - starter);
        else assert.equal(final.result, 'draw');
      }
    }
  });

  test('stronger levels beat weaker ones more often than not', () => {
    const rng = mulberry32(99);
    const score = (a, b, n) => {
      let wa = 0;
      let wb = 0;
      for (let i = 0; i < n; i++) {
        const starter = i % 2;
        const f = playGame([a, b], starter, rng);
        if (f.winner === 0) wa++;
        if (f.winner === 1) wb++;
      }
      return { wa, wb };
    };
    const mr = score('medium', 'random', 40);
    assert.ok(mr.wa > mr.wb, `medium vs random ${JSON.stringify(mr)}`);
    const hm = score('hard', 'medium', 40);
    assert.ok(hm.wa > hm.wb, `hard vs medium ${JSON.stringify(hm)}`);
    globalThis.__dreesLevelStats = { mr, hm };
  });
});
