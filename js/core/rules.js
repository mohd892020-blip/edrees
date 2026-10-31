/**
 * Drees (دريس) — pure game rules.
 *
 * The whole game is a reducer: `applyAction(state, action) -> newState`.
 * State and actions are plain JSON-serializable objects, nothing here touches
 * the DOM, timers or randomness, so the exact same module can run on a server,
 * in a peer over WebRTC/Bluetooth, in a worker or in tests.
 *
 * Board: 9 cells indexed row-major (0..8). A cell holds `null` (empty), 0 or 1
 * (player id) or BLOCKED (a sealed cell in some variants).
 *
 * Flow (classic rules):
 *  1. Placement — the toss winner (`starter`) places all 3 pieces one by one,
 *     then the other player places 3 pieces in the remaining empty cells.
 *     Nobody may complete a line of their own pieces while placing — row,
 *     column or diagonal — so a line can only ever be made by moving.
 *  2. Movement — the starter moves first; each turn moves one own piece to any
 *     empty cell (not necessarily adjacent). A player wins when, after their
 *     move, their 3 pieces form a horizontal or vertical line. Diagonals never win.
 *  3. Draw — the same position (board + side to move) occurs `repetitionLimit`
 *     times, or `maxMoves` movement moves pass without a winner.
 *
 * Variants (used by the campaign) change three things only:
 *  - `moves`: 'any' (classic), 'king' (one step to any touching cell) or
 *    'orth' (one step up/down/left/right);
 *  - `diagonals`: diagonal lines also win;
 *  - `blocked`: sealed cells nobody may use.
 * A player who has no legal move on their turn loses (only possible when
 * moves are restricted).
 */

export const BOARD_SIZE = 3;
export const CELL_COUNT = 9;
export const PIECES_PER_PLAYER = 3;
export const DEFAULT_MAX_MOVES = 50;
export const DEFAULT_REPETITION_LIMIT = 3;
export const BLOCKED = -1;

export const Phase = Object.freeze({
  PLACEMENT: 'placement',
  MOVEMENT: 'movement',
  OVER: 'over',
});

export const ActionType = Object.freeze({
  PLACE: 'place',
  MOVE: 'move',
});

export const DrawReason = Object.freeze({
  REPETITION: 'repetition',
  MOVE_LIMIT: 'move-limit',
});

export const WinReason = Object.freeze({
  LINE: 'line',
  BLOCKED: 'blocked',
});

export const MoveRule = Object.freeze({
  ANY: 'any',
  KING: 'king',
  ORTH: 'orth',
});

export const Reason = Object.freeze({
  MALFORMED: 'malformed',
  GAME_OVER: 'game-over',
  NOT_YOUR_TURN: 'not-your-turn',
  WRONG_PHASE: 'wrong-phase',
  OUT_OF_RANGE: 'out-of-range',
  BLOCKED_CELL: 'blocked-cell',
  CELL_OCCUPIED: 'cell-occupied',
  FORMS_LINE: 'forms-line',
  NOT_YOUR_PIECE: 'not-your-piece',
  SAME_CELL: 'same-cell',
  NOT_ADJACENT: 'not-adjacent',
  UNKNOWN_ACTION: 'unknown-action',
});

const ROWS = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
const COLS = [[0, 3, 6], [1, 4, 7], [2, 5, 8]];

/** Classic winning lines: rows and columns only. */
export const LINES = Object.freeze([...ROWS, ...COLS].map((l) => Object.freeze(l)));

/** Diagonals win only in the "diagonals" variant. */
export const DIAGONALS = Object.freeze([Object.freeze([0, 4, 8]), Object.freeze([2, 4, 6])]);

export const opponent = (player) => 1 - player;
export const rowOf = (cell) => Math.floor(cell / BOARD_SIZE);
export const colOf = (cell) => cell % BOARD_SIZE;
export const isCell = (cell) => Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT;

// ───────────────────────── variants ─────────────────────────

export const CLASSIC = Object.freeze({ moves: MoveRule.ANY, diagonals: false, blocked: Object.freeze([]) });

// Search code calls these at every node, so results are cached per object.
const normCache = new WeakMap();
const lineCache = new Map();
const lineByObject = new WeakMap();

export function normalizeVariant(v) {
  if (!v || v === CLASSIC) return CLASSIC;
  const hit = normCache.get(v);
  if (hit) return hit;
  const moves = Object.values(MoveRule).includes(v.moves) ? v.moves : MoveRule.ANY;
  const blocked = [...new Set((v.blocked || []).filter(isCell))].sort((a, b) => a - b);
  const n = moves === MoveRule.ANY && !v.diagonals && !blocked.length
    ? CLASSIC
    : { moves, diagonals: !!v.diagonals, blocked };
  normCache.set(v, n);
  if (n !== CLASSIC) normCache.set(n, n);
  return n;
}

export function variantKey(v) {
  const n = normalizeVariant(v);
  return `${n.moves}|${n.diagonals ? 'd' : '-'}|${n.blocked.join('.')}`;
}

/** Winning lines for a variant (lines through sealed cells can never be completed). */
export function linesFor(v) {
  if (!v || v === CLASSIC) return LINES;
  let lines = lineByObject.get(v);
  if (lines) return lines;
  const key = variantKey(v);
  lines = lineCache.get(key);
  if (!lines) {
    const n = normalizeVariant(v);
    lines = (n.diagonals ? [...LINES, ...DIAGONALS] : LINES).filter((l) => !l.some((c) => n.blocked.includes(c)));
    lineCache.set(key, lines);
  }
  lineByObject.set(v, lines);
  return lines;
}

const placementLineCache = new Map();
/**
 * Lines nobody may complete while placing: every row, column and diagonal
 * (whether or not it wins in this variant), except lines through sealed cells.
 */
export function placementLines(v) {
  const key = variantKey(v);
  let lines = placementLineCache.get(key);
  if (!lines) {
    const n = normalizeVariant(v);
    lines = [...LINES, ...DIAGONALS].filter((l) => !l.some((c) => n.blocked.includes(c)));
    placementLineCache.set(key, lines);
  }
  return lines;
}

/** Would placing `player` on `cell` complete a line of their own pieces? */
export function formsLine(board, player, cell, v) {
  for (const line of placementLines(v)) {
    if (!line.includes(cell)) continue;
    if (line.every((c) => c === cell || board[c] === player)) return true;
  }
  return false;
}

/** Empty cells where `player` may place a piece. */
export function legalPlacements(board, player, v) {
  const out = [];
  for (let i = 0; i < CELL_COUNT; i++) if (board[i] === null && !formsLine(board, player, i, v)) out.push(i);
  return out;
}

/** Whether a piece may travel from `from` to `to` under the variant's move rule. */
export function canStep(from, to, v) {
  const moves = (v && v.moves) || MoveRule.ANY;
  if (from === to) return false;
  if (moves === MoveRule.ANY) return true;
  const dr = Math.abs(rowOf(from) - rowOf(to));
  const dc = Math.abs(colOf(from) - colOf(to));
  return moves === MoveRule.KING ? Math.max(dr, dc) === 1 : dr + dc === 1;
}

const variantOf = (state) => (state.rules && state.rules.variant) || CLASSIC;

// ───────────────────────── creation ─────────────────────────

/**
 * Creates a fresh game. `starter` is the toss winner (0 or 1); the toss itself
 * is done by whoever hosts the match so this module stays deterministic.
 */
export function createGame({
  starter = 0,
  maxMoves = DEFAULT_MAX_MOVES,
  repetitionLimit = DEFAULT_REPETITION_LIMIT,
  variant = CLASSIC,
} = {}) {
  if (starter !== 0 && starter !== 1) throw new Error('starter must be 0 or 1');
  const v = normalizeVariant(variant);
  const board = Array(CELL_COUNT).fill(null);
  for (const c of v.blocked) board[c] = BLOCKED;
  return {
    board,
    phase: Phase.PLACEMENT,
    starter,
    turn: starter,
    placed: [0, 0],
    moveCount: 0,
    ply: 0,
    positions: {},
    winner: null,
    winLine: null,
    winReason: null,
    result: null,
    drawReason: null,
    lastAction: null,
    rules: { maxMoves, repetitionLimit, variant: v },
  };
}

/**
 * Builds a valid state from an arbitrary position (puzzles, challenges).
 * `board` lists 0/1/null per cell; sealed cells come from the variant.
 * With 3 + 3 pieces the game is in the movement phase and `turn` moves next.
 */
export function createPosition({ board, starter = 0, turn = starter, ...options }) {
  const state = createGame({ starter, ...options });
  const b = state.board;
  board.forEach((v, i) => {
    if (b[i] !== BLOCKED && (v === 0 || v === 1)) b[i] = v;
  });
  const placed = [cellsOf(b, 0).length, cellsOf(b, 1).length];
  if (placed.some((n) => n > PIECES_PER_PLAYER)) throw new Error('too many pieces');
  if (placed[opponent(starter)] > 0 && placed[starter] < PIECES_PER_PLAYER) {
    throw new Error('the second player can only place after the starter');
  }
  state.placed = placed;
  if (placed[0] === PIECES_PER_PLAYER && placed[1] === PIECES_PER_PLAYER) {
    state.phase = Phase.MOVEMENT;
    state.turn = turn;
    state.positions = { [positionKey(b, turn)]: 1 };
  } else {
    state.turn = placementTurn(starter, placed);
  }
  return state;
}

// ───────────────────────── queries ─────────────────────────

export function positionKey(board, turn) {
  let s = '';
  for (const v of board) s += v === null ? '.' : v === BLOCKED ? 'x' : String(v);
  return `${s}:${turn}`;
}

export function emptyCells(board) {
  const out = [];
  for (let i = 0; i < CELL_COUNT; i++) if (board[i] === null) out.push(i);
  return out;
}

export function cellsOf(board, player) {
  const out = [];
  for (let i = 0; i < CELL_COUNT; i++) if (board[i] === player) out.push(i);
  return out;
}

/** Returns a winning line fully owned by `player`, or null. */
export function findLine(board, player, lines = LINES) {
  for (const line of lines) {
    if (board[line[0]] === player && board[line[1]] === player && board[line[2]] === player) {
      return line.slice();
    }
  }
  return null;
}

/** Empty cells reachable by the piece on `from`. */
export function legalTargets(board, from, variant = CLASSIC) {
  const out = [];
  for (let to = 0; to < CELL_COUNT; to++) if (board[to] === null && canStep(from, to, variant)) out.push(to);
  return out;
}

export function hasLegalMove(board, player, variant = CLASSIC) {
  for (let f = 0; f < CELL_COUNT; f++) {
    if (board[f] === player && legalTargets(board, f, variant).length) return true;
  }
  return false;
}

/** Moves with which `player` would complete a line right now. */
export function winningMoves(board, player, variant = CLASSIC) {
  const lines = linesFor(variant);
  const b = board.slice();
  const out = [];
  for (let from = 0; from < CELL_COUNT; from++) {
    if (b[from] !== player) continue;
    for (const to of legalTargets(b, from, variant)) {
      b[from] = null;
      b[to] = player;
      if (findLine(b, player, lines)) out.push({ from, to });
      b[to] = null;
      b[from] = player;
    }
  }
  return out;
}

/** Cells where `player` would complete a line by moving a piece in (movement phase). */
export function winningCells(board, player, variant = CLASSIC) {
  return [...new Set(winningMoves(board, player, variant).map((m) => m.to))];
}

/** Whose turn it is during placement, given how many pieces each player placed. */
export function placementTurn(starter, placed) {
  return placed[starter] < PIECES_PER_PLAYER ? starter : opponent(starter);
}

// ───────────────────────── validation ─────────────────────────

const OK = Object.freeze({ ok: true, reason: null });
const fail = (reason) => ({ ok: false, reason });

export function validateAction(state, action) {
  if (!action || typeof action !== 'object') return fail(Reason.MALFORMED);
  if (state.phase === Phase.OVER) return fail(Reason.GAME_OVER);
  if (action.player !== state.turn) return fail(Reason.NOT_YOUR_TURN);

  if (action.type === ActionType.PLACE) {
    if (state.phase !== Phase.PLACEMENT) return fail(Reason.WRONG_PHASE);
    if (!isCell(action.to)) return fail(Reason.OUT_OF_RANGE);
    if (state.board[action.to] === BLOCKED) return fail(Reason.BLOCKED_CELL);
    if (state.board[action.to] !== null) return fail(Reason.CELL_OCCUPIED);
    if (formsLine(state.board, action.player, action.to, variantOf(state))) return fail(Reason.FORMS_LINE);
    return OK;
  }

  if (action.type === ActionType.MOVE) {
    if (state.phase !== Phase.MOVEMENT) return fail(Reason.WRONG_PHASE);
    if (!isCell(action.from) || !isCell(action.to)) return fail(Reason.OUT_OF_RANGE);
    if (state.board[action.from] !== action.player) return fail(Reason.NOT_YOUR_PIECE);
    if (action.from === action.to) return fail(Reason.SAME_CELL);
    if (state.board[action.to] === BLOCKED) return fail(Reason.BLOCKED_CELL);
    if (state.board[action.to] !== null) return fail(Reason.CELL_OCCUPIED);
    if (!canStep(action.from, action.to, variantOf(state))) return fail(Reason.NOT_ADJACENT);
    return OK;
  }

  return fail(Reason.UNKNOWN_ACTION);
}

export const isLegal = (state, action) => validateAction(state, action).ok;

export class IllegalActionError extends Error {
  constructor(reason, action) {
    super(`Illegal action (${reason}): ${JSON.stringify(action)}`);
    this.name = 'IllegalActionError';
    this.reason = reason;
    this.action = action;
  }
}

/** Every legal action for the side to move. */
export function legalActions(state) {
  if (state.phase === Phase.OVER) return [];
  const player = state.turn;
  if (state.phase === Phase.PLACEMENT) {
    return legalPlacements(state.board, player, variantOf(state)).map((to) => ({ type: ActionType.PLACE, player, to }));
  }
  const out = [];
  for (const from of cellsOf(state.board, player)) {
    for (const to of legalTargets(state.board, from, variantOf(state))) {
      out.push({ type: ActionType.MOVE, player, from, to });
    }
  }
  return out;
}

// ───────────────────────── reducer ─────────────────────────

/** The reducer. Never mutates `state`; throws IllegalActionError on bad input. */
export function applyAction(state, action) {
  const check = validateAction(state, action);
  if (!check.ok) throw new IllegalActionError(check.reason, action);

  const variant = variantOf(state);
  const player = action.player;
  const board = state.board.slice();
  const next = {
    ...state,
    board,
    ply: state.ply + 1,
    lastAction: { ...action },
  };

  if (action.type === ActionType.PLACE) {
    board[action.to] = player;
    const placed = state.placed.slice();
    placed[player]++;
    next.placed = placed;
    if (placed[0] === PIECES_PER_PLAYER && placed[1] === PIECES_PER_PLAYER) {
      // Placement is over (no line can exist yet): the starter opens the movement phase.
      next.phase = Phase.MOVEMENT;
      next.turn = state.starter;
      next.positions = { [positionKey(board, next.turn)]: 1 };
      if (!hasLegalMove(board, next.turn, variant)) return endInWin(next, opponent(next.turn), WinReason.BLOCKED);
    } else {
      next.turn = placementTurn(state.starter, placed);
    }
    return next;
  }

  // Movement
  board[action.from] = null;
  board[action.to] = player;
  next.moveCount = state.moveCount + 1;

  // Only the mover can win, and any line of theirs necessarily includes the moved piece.
  const line = findLine(board, player, linesFor(variant));
  if (line) {
    next.winLine = line;
    return endInWin(next, player, WinReason.LINE);
  }

  next.turn = opponent(player);
  if (!hasLegalMove(board, next.turn, variant)) return endInWin(next, player, WinReason.BLOCKED);

  const key = positionKey(board, next.turn);
  const positions = { ...state.positions, [key]: (state.positions[key] || 0) + 1 };
  next.positions = positions;

  if (positions[key] >= state.rules.repetitionLimit) {
    return endInDraw(next, DrawReason.REPETITION);
  }
  if (next.moveCount >= state.rules.maxMoves) {
    return endInDraw(next, DrawReason.MOVE_LIMIT);
  }
  return next;
}

function endInWin(next, winner, reason) {
  next.phase = Phase.OVER;
  next.turn = null;
  next.winner = winner;
  next.winReason = reason;
  next.result = 'win';
  return next;
}

function endInDraw(next, reason) {
  next.phase = Phase.OVER;
  next.turn = null;
  next.result = 'draw';
  next.drawReason = reason;
  return next;
}

/** Applies a list of actions in order (handy for replays, network sync and tests). */
export function replay(actions, options) {
  let state = createGame(options);
  for (const a of actions) state = applyAction(state, a);
  return state;
}

/** Cells where each player could win on their next move (movement phase only). */
export function threats(state) {
  if (state.phase !== Phase.MOVEMENT) return [[], []];
  const v = variantOf(state);
  return [winningCells(state.board, 0, v), winningCells(state.board, 1, v)];
}
