/**
 * Pointer input (mouse + touch + pen) → game actions.
 * Supports drag-and-drop and tap-to-select-then-tap-destination.
 * Every candidate action is checked with the pure rules before being sent,
 * and once a piece is dropped on a valid cell the move is final.
 */
import { Phase, ActionType, BLOCKED, CLASSIC, validateAction, legalTargets } from '../core/rules.js';
import { refusalText } from './text.js';

const DRAG_THRESHOLD = 7; // CSS px

export class InputController {
  constructor({ canvas, renderer, sound, onHint = () => {}, onCommit = () => {} }) {
    this.canvas = canvas;
    this.r = renderer;
    this.sound = sound;
    this.onHint = onHint;
    this.onCommit = onCommit;
    this.pending = null;
    this.ptr = null;

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', () => this._cancel());
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.ptr) this._setHover(null);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pending) this._deselect();
    });
  }

  /** Resolves with { action, meta } once the local player commits a legal action. */
  waitForAction(state, signal) {
    return new Promise((resolve, reject) => {
      this.pending = { state, player: state.turn, resolve };
      if (signal) {
        signal.addEventListener('abort', () => {
          this.reset();
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
      this._refresh();
    });
  }

  /** Whether the local player is currently expected to act. */
  get active() {
    return !!this.pending;
  }

  reset() {
    this.pending = null;
    if (this.ptr && this.ptr.dragging) {
      this.sound.dragStop();
      this.r.cancelDrag();
    }
    this.ptr = null;
    this.r.select(null);
    this._setHover(null);
    this._refresh();
  }

  // ───────────────────────── helpers ─────────────────────────

  get _state() {
    return this.pending && this.pending.state;
  }

  get _variant() {
    const st = this._state;
    return (st && st.rules.variant) || CLASSIC;
  }

  _ownTray(p) {
    return p.owner === this.pending.player && p.cell === null;
  }

  _ownBoard(p) {
    return p.owner === this.pending.player && p.cell !== null;
  }

  _canGrab(p) {
    const st = this._state;
    if (!st) return false;
    return st.phase === Phase.PLACEMENT ? this._ownTray(p) : this._ownBoard(p);
  }

  _targetsOf(p) {
    return p && p.cell !== null ? legalTargets(this._state.board, p.cell, this._variant) : [];
  }

  _refresh() {
    const r = this.r;
    const st = this._state;
    if (!st) {
      r.interactiveCells = [];
      r.interactivePieces = [];
      r.ghost = null;
      return;
    }
    const dragging = this.ptr && this.ptr.dragging;
    if (st.phase === Phase.PLACEMENT) {
      const empty = [];
      st.board.forEach((v, i) => v === null && empty.push(i));
      r.interactiveCells = empty;
      r.interactivePieces = r.selected || dragging ? [] : r.pieces.filter((p) => this._ownTray(p));
    } else {
      const active = dragging ? this.ptr.piece : r.selected;
      r.interactiveCells = active ? this._targetsOf(active) : [];
      r.interactivePieces = active
        ? []
        : r.pieces.filter((p) => this._ownBoard(p) && this._targetsOf(p).length);
    }
  }

  _setHover(cell) {
    const r = this.r;
    const st = this._state;
    const valid = st && cell !== null && r.interactiveCells.includes(cell);
    r.hoverCell = valid ? cell : null;
    r.ghost = valid && st.phase === Phase.PLACEMENT && !(this.ptr && this.ptr.dragging)
      ? { cell, owner: this.pending.player }
      : null;
  }

  _deselect() {
    this.r.select(null);
    this._refresh();
  }

  /** Sends the action if legal; returns null on success or the refusal reason. */
  _try(action, meta) {
    const st = this._state;
    if (!st) return 'game-over';
    const check = validateAction(st, action);
    if (!check.ok) return check.reason;
    const { resolve } = this.pending;
    this.pending = null;
    this.r.selected = null;
    this._setHover(null);
    this._refresh();
    this.onCommit(action);
    resolve({ action, meta });
    return null;
  }

  _placeAt(cell, via, pieceId) {
    return this._try({ type: ActionType.PLACE, player: this._state.turn, to: cell }, { via, pieceId });
  }

  _moveTo(from, to, via) {
    return this._try({ type: ActionType.MOVE, player: this._state.turn, from, to }, { via });
  }

  /** Error feedback for a refused action (a rules reason code). */
  _invalid(reason) {
    this._invalidText(refusalText(reason, this._variant));
  }

  _invalidText(text) {
    this.sound.error();
    if (text) this.onHint(text, true);
  }

  // ───────────────────────── pointer events ─────────────────────────

  _down(e) {
    this.sound.unlock();
    if (!this.pending || this.ptr) return;
    e.preventDefault();
    const pt = this.r.eventToCanvas(e);
    const st = this._state;
    let piece = this.r.pieceAtScreen(pt.x, pt.y, (p) => this._canGrab(p));
    if (!piece && st.phase === Phase.MOVEMENT) {
      // Generous fallback: pressing anywhere in a cell holding your piece grabs it.
      const cell = this.r.cellAtScreen(pt.x, pt.y);
      if (cell !== null && st.board[cell] === this.pending.player) piece = this.r.pieceAtCell(cell);
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.ptr = {
      id: e.pointerId, type: e.pointerType, piece, start: pt, last: pt,
      lastT: performance.now(), dragging: false,
    };
  }

  _move(e) {
    const pt = this.r.eventToCanvas(e);
    const ptr = this.ptr;
    if (!ptr) {
      // Mouse hover feedback.
      if (e.pointerType === 'mouse' && this.pending) {
        this._setHover(this.r.cellAtScreen(pt.x, pt.y));
        const overPiece = this.r.pieceAtScreen(pt.x, pt.y, (p) => this._canGrab(p));
        this.canvas.style.cursor = overPiece ? 'grab' : this.r.hoverCell !== null ? 'pointer' : 'default';
      }
      return;
    }
    if (e.pointerId !== ptr.id) return;
    const dpr = this.r.dpr;
    if (!ptr.dragging && ptr.piece) {
      const d = Math.hypot(pt.x - ptr.start.x, pt.y - ptr.start.y) / dpr;
      if (d > DRAG_THRESHOLD) {
        ptr.dragging = true;
        this.r.beginDrag(ptr.piece, pt.x, pt.y, ptr.type === 'touch' ? 0.65 : 0.42);
        this.sound.pickup();
        this.sound.dragStart();
        this.canvas.style.cursor = 'grabbing';
        this._refresh();
      }
    }
    if (ptr.dragging) {
      this.r.dragTo(pt.x, pt.y);
      const now = performance.now();
      const dt = Math.max(1, now - ptr.lastT) / 1000;
      const speed = Math.hypot(pt.x - ptr.last.x, pt.y - ptr.last.y) / dpr / dt;
      this.sound.dragUpdate(speed);
      this._setHover(this.r.dragCell());
    }
    ptr.last = pt;
    ptr.lastT = performance.now();
  }

  _up(e) {
    const ptr = this.ptr;
    if (!ptr || e.pointerId !== ptr.id) return;
    this.ptr = null;
    this.canvas.style.cursor = 'default';
    const st = this._state;
    if (!st) return;
    const pt = this.r.eventToCanvas(e);

    if (ptr.dragging) {
      this.sound.dragStop();
      const piece = ptr.piece;
      const cell = this.r.dragCell();
      this._setHover(null);
      if (cell !== null && cell !== piece.cell) {
        const action = st.phase === Phase.PLACEMENT
          ? { type: ActionType.PLACE, player: st.turn, to: cell }
          : { type: ActionType.MOVE, player: st.turn, from: piece.cell, to: cell };
        const check = validateAction(st, action);
        if (check.ok) {
          this.r.endDrag();
          this._try(action, { via: 'drag', pieceId: piece.id });
          return;
        }
        this._invalid(check.reason);
      }
      this.r.cancelDrag().then(() => this._refresh());
      this._refresh();
      return;
    }

    // A tap.
    const tapped = ptr.piece;
    if (tapped) {
      if (this.r.selected === tapped) this._deselect();
      else {
        this.r.select(tapped);
        this.sound.select();
        this._refresh();
        if (st.phase === Phase.MOVEMENT && !this._targetsOf(tapped).length) {
          this.onHint('هذه القطعة محاصرة: لا يوجد مربع تستطيع الانتقال إليه', true);
        }
      }
      return;
    }
    const cell = this.r.cellAtScreen(pt.x, pt.y);
    if (cell === null) {
      this._deselect();
      return;
    }
    if (st.board[cell] === BLOCKED) {
      this._invalid('blocked-cell');
      return;
    }
    if (st.board[cell] !== null) {
      this._invalidText(st.board[cell] === this.pending.player ? null : 'لا يمكنك اللعب فوق قطعة الخصم');
      return;
    }
    if (st.phase === Phase.PLACEMENT) {
      const sel = this.r.selected;
      this._placeAt(cell, 'tap', sel ? sel.id : null);
      return;
    }
    if (this.r.selected) {
      const reason = this._moveTo(this.r.selected.cell, cell, 'tap');
      if (reason) this._invalid(reason);
      return;
    }
    this._invalidText('اختر إحدى قطعك أولاً، ثم المربع الفارغ');
  }

  _cancel() {
    const ptr = this.ptr;
    this.ptr = null;
    if (ptr && ptr.dragging) {
      this.sound.dragStop();
      this.r.cancelDrag().then(() => this._refresh());
    }
    this._setHover(null);
    this._refresh();
  }
}
