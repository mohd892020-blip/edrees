import { describe, test, assert } from './harness.js';
import {
  createGame,
  applyAction,
  validateAction,
  legalActions,
  findLine,
  winningCells,
  positionKey,
  replay,
  Phase,
  Reason,
  DrawReason,
  DIAGONALS,
  LINES,
  IllegalActionError,
} from '../js/core/rules.js';

const place = (player, to) => ({ type: 'place', player, to });
const move = (player, from, to) => ({ type: 'move', player, from, to });

/** Builds a movement-phase state from a 9-char picture like "00.11.01." (. = empty). */
function fromPicture(picture, { turn = 0, starter = turn, maxMoves, repetitionLimit } = {}) {
  const cells = [...picture].map((ch) => (ch === '.' ? null : Number(ch)));
  const p0 = cells.flatMap((v, i) => (v === 0 ? [i] : []));
  const p1 = cells.flatMap((v, i) => (v === 1 ? [i] : []));
  const first = starter === 0 ? p0 : p1;
  const second = starter === 0 ? p1 : p0;
  const actions = [
    ...first.map((c) => place(starter, c)),
    ...second.map((c) => place(1 - starter, c)),
  ];
  let state = replay(actions, { starter, maxMoves, repetitionLimit });
  if (state.turn !== turn) {
    // Hand the turn over without disturbing the picture: use a real state with adjusted turn.
    state = { ...state, turn, positions: { [positionKey(state.board, turn)]: 1 } };
  }
  return state;
}

describe('placement phase', () => {
  test('starter places all three pieces first, then the other player', () => {
    let s = createGame({ starter: 1 });
    assert.equal(s.turn, 1);
    s = applyAction(s, place(1, 0));
    assert.equal(s.turn, 1);
    s = applyAction(s, place(1, 4));
    assert.equal(s.turn, 1);
    s = applyAction(s, place(1, 8));
    assert.equal(s.turn, 0, 'second player starts placing after starter finished');
    s = applyAction(s, place(0, 1));
    s = applyAction(s, place(0, 2));
    assert.equal(s.phase, Phase.PLACEMENT);
    s = applyAction(s, place(0, 3));
    assert.equal(s.phase, Phase.MOVEMENT);
    assert.equal(s.turn, 1, 'starter opens the movement phase');
  });

  test('cannot place on an occupied cell', () => {
    let s = createGame({ starter: 0 });
    s = applyAction(s, place(0, 4));
    assert.equal(validateAction(s, place(0, 4)).reason, Reason.CELL_OCCUPIED);
  });

  test('cannot place out of turn', () => {
    const s = createGame({ starter: 0 });
    assert.equal(validateAction(s, place(1, 4)).reason, Reason.NOT_YOUR_TURN);
  });

  test('cannot place outside the board', () => {
    const s = createGame({ starter: 0 });
    assert.equal(validateAction(s, place(0, 9)).reason, Reason.OUT_OF_RANGE);
    assert.equal(validateAction(s, place(0, -1)).reason, Reason.OUT_OF_RANGE);
    assert.equal(validateAction(s, place(0, 1.5)).reason, Reason.OUT_OF_RANGE);
  });

  test('moving is not allowed during placement', () => {
    let s = createGame({ starter: 0 });
    s = applyAction(s, place(0, 0));
    assert.equal(validateAction(s, move(0, 0, 1)).reason, Reason.WRONG_PHASE);
  });

  test('a line formed by the starter while placing is NOT a win', () => {
    let s = createGame({ starter: 0 });
    for (const c of [0, 1, 2]) s = applyAction(s, place(0, c));
    assert.equal(s.winner, null);
    assert.equal(s.phase, Phase.PLACEMENT);
    for (const c of [3, 4, 6]) s = applyAction(s, place(1, c));
    assert.equal(s.winner, null);
    assert.equal(s.phase, Phase.MOVEMENT);
  });

  test('a line formed by the second player at the end of placement is NOT a win', () => {
    let s = createGame({ starter: 0 });
    for (const c of [0, 1, 5]) s = applyAction(s, place(0, c));
    for (const c of [6, 7, 8]) s = applyAction(s, place(1, c)); // bottom row for player 1
    assert.equal(s.phase, Phase.MOVEMENT);
    assert.equal(s.winner, null, 'line during placement does not count');
    assert.equal(s.result, null);
  });

  test('a vertical line formed while placing is NOT a win either', () => {
    let s = createGame({ starter: 1 });
    for (const c of [2, 5, 8]) s = applyAction(s, place(1, c)); // right column for the starter
    for (const c of [0, 4, 7]) s = applyAction(s, place(0, c));
    assert.equal(s.phase, Phase.MOVEMENT);
    assert.equal(s.winner, null);
  });

  test('a placement line does not count even after the opponent moves', () => {
    let s = createGame({ starter: 0 });
    for (const c of [0, 1, 5]) s = applyAction(s, place(0, c));
    for (const c of [6, 7, 8]) s = applyAction(s, place(1, c));
    s = applyAction(s, move(0, 5, 4)); // starter makes a harmless move
    assert.equal(s.phase, Phase.MOVEMENT);
    assert.equal(s.winner, null);
    assert.equal(s.turn, 1);
  });
});

describe('win detection', () => {
  test('only rows and columns are winning lines', () => {
    assert.equal(LINES.length, 6);
    for (const d of DIAGONALS) {
      assert.ok(!LINES.some((l) => l.join() === d.join()), 'diagonal must not be a line');
    }
  });

  test('horizontal line wins (every row)', () => {
    for (const row of [0, 1, 2]) {
      const b = Array(9).fill(null);
      for (let c = 0; c < 3; c++) b[row * 3 + c] = 1;
      assert.deepEqual(findLine(b, 1), [row * 3, row * 3 + 1, row * 3 + 2]);
    }
  });

  test('vertical line wins (every column)', () => {
    for (const col of [0, 1, 2]) {
      const b = Array(9).fill(null);
      for (let r = 0; r < 3; r++) b[r * 3 + col] = 0;
      assert.deepEqual(findLine(b, 0), [col, col + 3, col + 6]);
    }
  });

  test('diagonals never win', () => {
    for (const d of DIAGONALS) {
      const b = Array(9).fill(null);
      for (const i of d) b[i] = 0;
      assert.equal(findLine(b, 0), null);
    }
  });

  test('moving into a horizontal line wins the game', () => {
    // 0 0 .
    // 1 1 .
    // 0 1 .
    let s = fromPicture('00.11.01.', { turn: 0 });
    s = applyAction(s, move(0, 6, 2));
    assert.equal(s.phase, Phase.OVER);
    assert.equal(s.winner, 0);
    assert.equal(s.result, 'win');
    assert.deepEqual(s.winLine, [0, 1, 2]);
    assert.equal(s.turn, null);
  });

  test('moving into a vertical line wins the game', () => {
    // 1 0 .
    // 1 . 0
    // . 0 1   -> player 1 completes column 0 by moving 8 -> 6
    let s = fromPicture('10.1.0.01', { turn: 1, starter: 0 });
    s = applyAction(s, move(1, 8, 6));
    assert.equal(s.winner, 1);
    assert.deepEqual(s.winLine, [0, 3, 6]);
  });

  test('moving into a diagonal does NOT win', () => {
    // 0 1 .
    // 1 0 .
    // 1 0 .   -> player 0 moves 7 -> 8 forming the 0-4-8 diagonal
    let s = fromPicture('01.10.10.', { turn: 0 });
    s = applyAction(s, move(0, 7, 8));
    assert.equal(s.winner, null);
    assert.equal(s.phase, Phase.MOVEMENT);
    assert.equal(s.turn, 1);
  });

  test('winningCells finds immediate threats in rows/columns only', () => {
    const b = [0, 0, null, 1, null, 1, null, 1, 0];
    assert.deepEqual(winningCells(b, 0).sort(), [2]);
    assert.deepEqual(winningCells(b, 1).sort(), [4]);
  });
});

describe('move validity', () => {
  const s = fromPicture('00.11.01.', { turn: 0 });

  test('legal move to any empty cell, adjacency not required', () => {
    assert.ok(validateAction(s, move(0, 0, 8)).ok);
    assert.ok(validateAction(s, move(0, 1, 5)).ok);
  });

  test('cannot move an opponent piece', () => {
    assert.equal(validateAction(s, move(0, 3, 2)).reason, Reason.NOT_YOUR_PIECE);
  });

  test('cannot move from an empty cell', () => {
    assert.equal(validateAction(s, move(0, 2, 5)).reason, Reason.NOT_YOUR_PIECE);
  });

  test('cannot move onto an occupied cell', () => {
    assert.equal(validateAction(s, move(0, 0, 3)).reason, Reason.CELL_OCCUPIED);
    assert.equal(validateAction(s, move(0, 0, 1)).reason, Reason.CELL_OCCUPIED);
  });

  test('cannot "move" a piece onto itself', () => {
    assert.equal(validateAction(s, move(0, 0, 0)).reason, Reason.SAME_CELL);
  });

  test('cannot move out of turn', () => {
    assert.equal(validateAction(s, move(1, 3, 2)).reason, Reason.NOT_YOUR_TURN);
  });

  test('placing during movement is rejected', () => {
    assert.equal(validateAction(s, place(0, 2)).reason, Reason.WRONG_PHASE);
  });

  test('malformed and unknown actions are rejected', () => {
    assert.equal(validateAction(s, null).reason, Reason.MALFORMED);
    assert.equal(validateAction(s, { type: 'jump', player: 0 }).reason, Reason.UNKNOWN_ACTION);
  });

  test('applyAction throws IllegalActionError and does not mutate state', () => {
    const before = JSON.stringify(s);
    const err = assert.throws(() => applyAction(s, move(0, 0, 3)), (e) => e instanceof IllegalActionError);
    assert.equal(err.reason, Reason.CELL_OCCUPIED);
    assert.equal(JSON.stringify(s), before);
  });

  test('applyAction is pure (input state untouched)', () => {
    const before = JSON.stringify(s);
    const next = applyAction(s, move(0, 0, 8));
    assert.equal(JSON.stringify(s), before);
    assert.notEqual(next.board, s.board);
    assert.equal(next.board[0], null);
    assert.equal(next.board[8], 0);
    assert.equal(next.moveCount, 1);
    assert.equal(next.turn, 1);
  });

  test('turns alternate during movement', () => {
    let t = fromPicture('00.11.01.', { turn: 0 });
    t = applyAction(t, move(0, 0, 8));
    assert.equal(t.turn, 1);
    t = applyAction(t, move(1, 3, 0));
    assert.equal(t.turn, 0);
  });

  test('legalActions lists 3 pieces x 3 empties = 9 moves', () => {
    const acts = legalActions(s);
    assert.equal(acts.length, 9);
    assert.ok(acts.every((a) => validateAction(s, a).ok));
  });

  test('legalActions in placement lists every empty cell', () => {
    const g = createGame({ starter: 1 });
    assert.equal(legalActions(g).length, 9);
    assert.ok(legalActions(g).every((a) => a.player === 1 && a.type === 'place'));
  });

  test('no actions after the game is over', () => {
    const won = applyAction(fromPicture('00.11.01.', { turn: 0 }), move(0, 6, 2));
    assert.equal(legalActions(won).length, 0);
    assert.equal(validateAction(won, move(1, 3, 6)).reason, Reason.GAME_OVER);
  });
});

describe('draws', () => {
  test('threefold repetition of the same position is a draw', () => {
    // Shuffle back and forth without anyone completing a line.
    // 0 . 1
    // . 0 1
    // 1 . 0   (diagonal for 0 does not count)
    let s = fromPicture('0.1.011.0', { turn: 0 });
    const cycle = [move(0, 0, 1), move(1, 2, 3), move(0, 1, 0), move(1, 3, 2)];
    let i = 0;
    while (s.phase !== Phase.OVER && i < 40) {
      s = applyAction(s, cycle[i % 4]);
      i++;
    }
    assert.equal(s.result, 'draw');
    assert.equal(s.drawReason, DrawReason.REPETITION);
    assert.equal(s.winner, null);
    // Start position counted once at movement start, so the 3rd occurrence comes after 8 moves.
    assert.equal(s.moveCount, 8);
  });

  test('50 moves without a winner is a draw', () => {
    let s = fromPicture('0.1.011.0', { turn: 0, repetitionLimit: 1000 });
    const cycle = [move(0, 0, 1), move(1, 2, 3), move(0, 1, 0), move(1, 3, 2)];
    let i = 0;
    while (s.phase !== Phase.OVER) {
      s = applyAction(s, cycle[i % 4]);
      i++;
    }
    assert.equal(s.result, 'draw');
    assert.equal(s.drawReason, DrawReason.MOVE_LIMIT);
    assert.equal(s.moveCount, 50);
  });

  test('a win on the last allowed move is still a win', () => {
    let s = fromPicture('00.11.01.', { turn: 0, maxMoves: 1 });
    s = applyAction(s, move(0, 6, 2));
    assert.equal(s.result, 'win');
    assert.equal(s.winner, 0);
  });

  test('repetition is tracked by board AND side to move', () => {
    const a = positionKey([0, null, 1, null, 0, 1, 1, null, 0], 0);
    const b = positionKey([0, null, 1, null, 0, 1, 1, null, 0], 1);
    assert.notEqual(a, b);
  });
});

describe('serialization', () => {
  test('state survives a JSON round-trip and keeps working', () => {
    let s = createGame({ starter: 0 });
    for (const c of [0, 1, 5]) s = applyAction(s, place(0, c));
    for (const c of [6, 7, 2]) s = applyAction(s, place(1, c));
    const copy = JSON.parse(JSON.stringify(s));
    const a = applyAction(s, move(0, 5, 4));
    const b = applyAction(copy, move(0, 5, 4));
    assert.deepEqual(a, b);
  });
});
