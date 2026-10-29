import { describe, test, assert } from './harness.js';
import {
  createGame, createPosition, applyAction, validateAction, legalActions, linesFor, canStep,
  winningCells, normalizeVariant, Phase, Reason, BLOCKED, WinReason, MoveRule, CLASSIC,
} from '../js/core/rules.js';
import { getSolver, WIN, LOSS, DRAW } from '../js/ai/solver.js';
import { chooseAction, bestAction, LEVELS } from '../js/ai/ai.js';
import { reviewGame, gradeAction } from '../js/ai/review.js';
import { mulberry32 } from '../js/core/rng.js';

const move = (player, from, to) => ({ type: 'move', player, from, to });
const place = (player, to) => ({ type: 'place', player, to });
const pic = (s) => [...s].map((c) => (c === '.' ? null : Number(c)));

const KING = { moves: MoveRule.KING };
const ORTH = { moves: MoveRule.ORTH };
const DIAG = { diagonals: true };
const STONE = { moves: MoveRule.ORTH, blocked: [4] };

describe('variants › movement rules', () => {
  test('classic allows jumping anywhere', () => {
    assert.ok(canStep(0, 8, CLASSIC));
  });

  test('"king" moves one step in any direction, including diagonally', () => {
    assert.ok(canStep(0, 4, KING));
    assert.ok(canStep(4, 8, KING));
    assert.ok(!canStep(0, 2, KING));
    assert.ok(!canStep(0, 8, KING));
  });

  test('"orth" moves one step up, down, left or right only', () => {
    assert.ok(canStep(0, 1, ORTH));
    assert.ok(canStep(0, 3, ORTH));
    assert.ok(!canStep(0, 4, ORTH));
    assert.ok(!canStep(2, 3, ORTH), 'row wrap-around is not adjacent');
  });

  test('a long move is rejected with NOT_ADJACENT', () => {
    const s = createPosition({ board: pic('00.11.01.'), variant: KING });
    assert.equal(validateAction(s, move(0, 0, 8)).reason, Reason.NOT_ADJACENT);
    assert.ok(validateAction(s, move(0, 1, 5)).ok, 'diagonal step is fine');
  });

  test('legalActions only lists reachable cells', () => {
    const s = createPosition({ board: pic('00.11.01.'), variant: ORTH });
    for (const a of legalActions(s)) assert.ok(canStep(a.from, a.to, ORTH));
    assert.ok(legalActions(s).length < 9);
  });

  test('threats respect the move rule', () => {
    // 0 0 .   player 0 needs a piece next to cell 2; its third piece (8) is adjacent in king/orth.
    // . 1 1
    // 1 . 0
    const b = pic('00..111.0');
    assert.deepEqual(winningCells(b, 0, CLASSIC), [2]);
    assert.deepEqual(winningCells(b, 0, ORTH), [], '8 -> 2 is two steps away');
  });
});

describe('variants › lines and sealed cells', () => {
  test('diagonals win only in the diagonal variant', () => {
    let s = createPosition({ board: pic('01.10.10.'), variant: DIAG });
    s = applyAction(s, move(0, 7, 8));
    assert.equal(s.winner, 0);
    assert.deepEqual(s.winLine, [0, 4, 8]);
    let c = createPosition({ board: pic('01.10.10.') });
    c = applyAction(c, move(0, 7, 8));
    assert.equal(c.winner, null);
  });

  test('a sealed cell is BLOCKED, cannot be used and kills its lines', () => {
    const s = createGame({ variant: STONE });
    assert.equal(s.board[4], BLOCKED);
    assert.equal(validateAction(s, place(0, 4)).reason, Reason.BLOCKED_CELL);
    assert.equal(linesFor(STONE).length, 4, 'row 1 and column 1 pass through the centre');
    assert.equal(legalActions(s).length, 8);
  });

  test('normalizeVariant collapses defaults to CLASSIC', () => {
    assert.equal(normalizeVariant({}), CLASSIC);
    assert.equal(normalizeVariant({ moves: 'any', blocked: [] }), CLASSIC);
    assert.deepEqual(normalizeVariant({ moves: 'orth', blocked: [4, 4, 9] }), { moves: 'orth', diagonals: false, blocked: [4] });
  });
});

describe('variants › no legal move loses', () => {
  test('trapping the opponent wins the game', () => {
    // 1 1 0
    // 1 0 .     p1 (0,1,3) can only step into 2, 4 or 6 — after 7 -> 6 all are taken.
    // . 0 .
    let s = createPosition({ board: [1, 1, 0, 1, 0, null, null, 0, null], variant: ORTH, turn: 0 });
    s = applyAction(s, move(0, 7, 6));
    assert.equal(s.phase, Phase.OVER);
    assert.equal(s.winner, 0);
    assert.equal(s.winReason, WinReason.BLOCKED);
    assert.equal(s.winLine, null);
  });
});

describe('variants › createPosition', () => {
  test('a full board starts the movement phase with the requested side to move', () => {
    const s = createPosition({ board: pic('00.11.01.'), starter: 1, turn: 0 });
    assert.equal(s.phase, Phase.MOVEMENT);
    assert.equal(s.turn, 0);
    assert.deepEqual(s.placed, [3, 3]);
  });

  test('a partial board continues the placement with the right player', () => {
    const s = createPosition({ board: pic('1.1.1....'), starter: 1 });
    assert.equal(s.phase, Phase.PLACEMENT);
    assert.equal(s.turn, 0);
  });

  test('impossible placements are rejected', () => {
    assert.throws(() => createPosition({ board: pic('0........'), starter: 1 }));
  });
});

describe('variants › solver', () => {
  for (const [name, v, states] of [['king', KING, 3360], ['orth', ORTH, 3360], ['diagonals', DIAG, 3360], ['sealed centre', STONE, 1120]]) {
    test(`${name}: every value agrees with its successors`, () => {
      const S = getSolver(v);
      assert.equal(S.value.length, states);
      for (let s = 0; s < S.succ.length; s++) {
        const succ = S.succ[s];
        const val = S.value[s];
        const imm = succ.includes(-1);
        const anyLoss = succ.some((t) => t !== -1 && S.value[t] === LOSS);
        const allWin = succ.every((t) => t !== -1 && S.value[t] === WIN);
        if (val === WIN) assert.ok(imm || anyLoss);
        if (val === LOSS) assert.ok(!imm && allWin);
        if (val === DRAW) assert.ok(!imm && !anyLoss && !allWin);
      }
    });
  }

  test('restricted moves create longer forced wins than classic', () => {
    const longest = (v) => Math.max(...getSolver(v).dist);
    assert.equal(longest(CLASSIC), 3);
    assert.equal(longest(KING), 7);
  });

  test('with the centre sealed and straight steps, the second player wins', () => {
    assert.ok(getSolver(STONE).openingValue(0) < 0);
  });
});

describe('variants › AI', () => {
  test('every level plays only legal actions in every variant', () => {
    const rng = mulberry32(5);
    for (const v of [KING, ORTH, DIAG, STONE]) {
      for (const lvl of LEVELS) {
        for (let g = 0; g < 2; g++) {
          let s = createGame({ starter: g, variant: v });
          let guard = 0;
          while (s.phase !== Phase.OVER && guard++ < 200) {
            const a = s.turn === 0 ? chooseAction(s, lvl, rng) : chooseAction(s, 'easy', rng);
            assert.ok(validateAction(s, a).ok, `${lvl} illegal in ${JSON.stringify(v)}`);
            s = applyAction(s, a);
          }
        }
      }
    }
  });

  test('bestAction is deterministic and legal', () => {
    const s = createPosition({ board: pic('00.11.01.') });
    const a = bestAction(s);
    assert.deepEqual(a, bestAction(s));
    assert.ok(validateAction(s, a).ok);
    assert.equal(applyAction(s, a).winner, 0);
  });
});

describe('review', () => {
  // 0 0 . / 1 1 . / 0 1 .  — player 0 wins with 6 -> 2; player 1 threatens 5.
  const s = createPosition({ board: pic('00.11.01.'), turn: 0 });

  test('the winning move is graded best', () => {
    assert.equal(gradeAction(s, move(0, 6, 2)).verdict, 'best');
  });

  test('ignoring both the win and the threat is a blunder', () => {
    assert.equal(gradeAction(s, move(0, 6, 8)).verdict, 'blunder');
  });

  test('reviewGame grades only the chosen player and suggests the best move', () => {
    const actions = [move(0, 6, 8), move(1, 7, 5)];
    const r = reviewGame(s, actions, 0);
    assert.equal(r.items.length, 1);
    assert.equal(r.summary.blunders, 1);
    assert.deepEqual(r.items[0].best, { type: 'move', player: 0, from: 6, to: 2 });
  });
});
