/**
 * Turn orchestration. A Match owns the authoritative game state and asks the
 * player whose turn it is for an action. Players are interchangeable objects:
 *
 *   requestAction(state, signal) -> Promise<{ action, meta? }>
 *   observe?(action, state)       -> called after every applied action
 *
 * So a local human, the AI, or (later) a remote peer over WebSocket/WebRTC/
 * Bluetooth all plug in the same way, and the rules stay in core/rules.js.
 *
 * The presenter (UI) is notified and awaited so animations finish before
 * the next turn starts.
 */
import { createGame, applyAction, validateAction, Phase } from '../core/rules.js';

export class Match {
  /** Pass `state` to start from any position (puzzles, challenges, resumed games). */
  constructor({ players, starter = 0, state = null, presenter = {}, options = {} }) {
    this.players = players;
    this.presenter = presenter;
    this.state = state || createGame({ starter, ...options });
    this.history = [];
    this.controller = new AbortController();
  }

  get signal() {
    return this.controller.signal;
  }

  abort() {
    this.controller.abort();
  }

  async run() {
    const { presenter, signal } = this;
    if (presenter.onStart) await presenter.onStart(this.state);
    while (this.state.phase !== Phase.OVER) {
      if (signal.aborted) return null;
      const player = this.players[this.state.turn];
      if (presenter.onTurn) presenter.onTurn(this.state);

      let reply;
      try {
        reply = await player.requestAction(this.state, signal);
      } catch (err) {
        if (signal.aborted) return null;
        throw err;
      }
      if (signal.aborted) return null;

      const { action, meta = {} } = reply;
      const check = validateAction(this.state, action);
      if (!check.ok) {
        if (presenter.onIllegal) presenter.onIllegal(this.state, action, check.reason);
        continue;
      }
      const prev = this.state;
      this.state = applyAction(prev, action);
      this.history.push(action);
      for (const p of this.players) if (p.observe) p.observe(action, this.state);
      if (presenter.onAction) await presenter.onAction(prev, action, this.state, meta);
    }
    if (!signal.aborted && presenter.onEnd) await presenter.onEnd(this.state);
    return signal.aborted ? null : this.state;
  }
}
