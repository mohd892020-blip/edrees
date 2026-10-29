/** In-game heads-up display: turn indicator, phase, move counter, hints. */
import { Phase } from '../core/rules.js';

export class Hud {
  constructor() {
    const $ = (s) => document.querySelector(s);
    this.el = {
      phase: $('#hud-phase'),
      moves: $('#hud-moves'),
      turn: $('#turn-indicator'),
      turnText: $('#turn-text'),
      cards: [$('#card-human'), $('#card-ai')],
      subs: [$('#human-sub'), $('#ai-sub')],
      left: [$('#human-left'), $('#ai-left')],
      imgs: [$('#human-piece-img'), $('#ai-piece-img')],
      aiName: $('#ai-name'),
      hint: $('#hint-bar'),
      toast: $('#phase-toast'),
      goalRow: $('#goal-row'),
      goal: $('#hud-goal'),
      rule: $('#hud-rule'),
    };
    this._hintTimer = null;
    this._baseHint = '';
  }

  /** `tossed` = the starter was decided by the toss (otherwise the stage fixed it). */
  setup({ humanImg, aiImg, levelName, aiName = 'الكمبيوتر', tossed = true }) {
    this.el.imgs[0].replaceChildren(humanImg);
    this.el.imgs[1].replaceChildren(aiImg);
    this.el.aiName.textContent = aiName;
    this.levelName = levelName;
    this.tossed = tossed;
  }

  /** Stage goal and rule chips (hidden in classic games). */
  setGoal(goal = '', rule = '') {
    this.el.goal.textContent = goal ? `🎯 ${goal}` : '';
    this.el.rule.textContent = rule;
    this.el.goalRow.hidden = !goal && !rule;
  }

  update(state, { thinking = false, threats = [[], []] } = {}) {
    const { el } = this;
    const over = state.phase === Phase.OVER;
    el.phase.textContent = state.phase === Phase.PLACEMENT ? 'مرحلة الصفّ' : over ? 'انتهت المباراة' : 'مرحلة التحريك';
    el.phase.dataset.phase = state.phase;
    el.moves.textContent = state.phase === Phase.PLACEMENT
      ? `القطع المصفوفة ${state.placed[0] + state.placed[1]} / 6`
      : `الحركات ${state.moveCount} / ${state.rules.maxMoves}`;

    for (const p of [0, 1]) {
      const card = el.cards[p];
      card.classList.toggle('is-turn', state.turn === p);
      card.classList.toggle('is-danger', !over && threats[p].length > 0);
      card.classList.toggle('is-thinking', p === 1 && thinking);
      card.classList.toggle('is-starter', state.starter === p);
      const left = 3 - state.placed[p];
      el.left[p].replaceChildren(...Array.from({ length: 3 }, (_, i) => {
        const dot = document.createElement('i');
        if (i < left) dot.className = 'on';
        return dot;
      }));
      el.left[p].hidden = state.phase !== Phase.PLACEMENT;
      const parts = [];
      if (p === 1) parts.push(this.levelName);
      if (this.tossed && state.starter === p) parts.push('بدأ بالقرعة');
      el.subs[p].textContent = threats[p].length && !over ? 'على بعد حركة من الفوز!' : parts.join(' · ');
    }
    el.turn.dataset.turn = over ? 'none' : String(state.turn);
    el.turnText.textContent = over ? 'انتهت' : state.turn === 0 ? 'دورك' : 'دوره';
  }

  /** Sets the default hint; `flash` shows a temporary message (e.g. an error). */
  hint(text, flash = false) {
    clearTimeout(this._hintTimer);
    const el = this.el.hint;
    if (!flash) this._baseHint = text;
    el.textContent = text;
    el.classList.toggle('is-error', flash);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    if (flash) {
      this._hintTimer = setTimeout(() => {
        el.textContent = this._baseHint;
        el.classList.remove('is-error');
      }, 2200);
    }
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }
}
