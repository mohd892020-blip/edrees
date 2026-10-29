/**
 * Player implementations for Match. Each one only has to produce actions;
 * validation and state updates happen in the Match through core/rules.js.
 */
import { chooseAction } from '../ai/ai.js';
import { Phase } from '../core/rules.js';

const abortError = () => new DOMException('Aborted', 'AbortError');

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(abortError());
      }, { once: true });
    }
  });
}

/** A person playing on this device; actions come from the input controller. */
export class LocalHumanPlayer {
  constructor(input) {
    this.kind = 'human';
    this.input = input;
  }

  requestAction(state, signal) {
    return this.input.waitForAction(state, signal);
  }
}

/** Computer opponent with a natural-feeling "thinking" pause. */
export class AIPlayer {
  constructor(level, { onThinking = null } = {}) {
    this.kind = 'ai';
    this.level = level;
    this.onThinking = onThinking;
  }

  async requestAction(state, signal) {
    if (this.onThinking) this.onThinking(true, state);
    try {
      const t0 = performance.now();
      await sleep(40, signal); // let the UI paint the thinking state first
      const action = chooseAction(state, this.level);
      const placing = state.phase === Phase.PLACEMENT;
      const target = placing ? 450 + Math.random() * 400 : 700 + Math.random() * 700;
      const remaining = target - (performance.now() - t0);
      if (remaining > 0) await sleep(remaining, signal);
      return { action, meta: { via: 'ai' } };
    } finally {
      if (this.onThinking) this.onThinking(false, state);
    }
  }
}

/**
 * Extension point for online / Wi-Fi / Bluetooth play.
 * `transport` needs `send(message)` and `onMessage(handler)`; any channel
 * (WebSocket, WebRTC DataChannel, Web Bluetooth characteristic…) fits.
 * Actions travel as plain JSON and are validated by the receiving Match,
 * so a misbehaving peer can never corrupt the game state.
 */
export class RemotePlayer {
  constructor(transport, seat) {
    this.kind = 'remote';
    this.seat = seat;
    this.transport = transport;
    this.inbox = [];
    this.waiting = null;
    transport.onMessage((msg) => {
      if (!msg || msg.type !== 'action') return;
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve({ action: msg.action, meta: { via: 'remote' } });
      } else this.inbox.push(msg.action);
    });
  }

  requestAction(state, signal) {
    if (this.inbox.length) return Promise.resolve({ action: this.inbox.shift(), meta: { via: 'remote' } });
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      if (signal) signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
  }

  /** Forward local actions to the peer. */
  observe(action) {
    if (action.player !== this.seat) this.transport.send({ type: 'action', action });
  }
}
