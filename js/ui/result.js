/** End-of-match dialog: win / loss / draw, stars for stages, and next steps. */
import { movesPhrase } from './text.js';

const ICONS = {
  win: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 8h28v10c0 9-6 16-14 17-8-1-14-8-14-17z" fill="currentColor"/><path d="M18 12H8c0 9 5 14 12 15M46 12h10c0 9-5 14-12 15" fill="none" stroke="currentColor" stroke-width="4"/><path d="M28 35h8v9h-8zM20 50h24l2 8H18z" fill="currentColor"/></svg>`,
  lose: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="23" cy="27" r="3.5" fill="currentColor"/><circle cx="41" cy="27" r="3.5" fill="currentColor"/><path d="M21 46c6-7 16-7 22 0" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
  draw: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8v48M14 56h36M10 20h44" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M10 20l-7 16h14zM54 20l-7 16h14z" fill="currentColor"/><path d="M3 36a7 5 0 0 0 14 0M47 36a7 5 0 0 0 14 0" fill="currentColor"/></svg>`,
};

/** Classic-mode wording for how a game ended. */
export function describeEnd(state, opponentName = 'الكمبيوتر') {
  if (state.result === 'draw') {
    return {
      outcome: 'draw',
      title: 'تعادل',
      sub: state.drawReason === 'repetition'
        ? 'تكررت نفس الوضعية ثلاث مرات.'
        : `مرّت ${movesPhrase(state.rules.maxMoves)} دون فائز.`,
    };
  }
  if (state.winReason === 'blocked') {
    return state.winner === 0
      ? { outcome: 'win', title: 'فزت!', sub: `حاصرت قطع ${opponentName} فلم يعد يستطيع الحركة.` }
      : { outcome: 'lose', title: 'خسرت', sub: `حاصرك ${opponentName} فلم تعد تستطيع الحركة.` };
  }
  const line = state.winLine;
  const how = !line ? 'خط' : line[1] - line[0] === 1 ? 'خط أفقي' : line[1] - line[0] === 3 ? 'خط عمودي' : 'خط قطري';
  if (state.winner === 0) {
    return { outcome: 'win', title: 'فزت!', sub: `صففت قطعك الثلاث في ${how} بعد ${movesPhrase(state.moveCount)}.` };
  }
  return { outcome: 'lose', title: 'خسرت', sub: `صفّ ${opponentName} قطعه في ${how}. حاول مجدداً!` };
}

/**
 * Shows the dialog. `buttons` = [{ id, label, primary? }]; resolves with the
 * chosen id. `stats` (classic) and `stars` (stages) are optional.
 */
export function showResult({ info, stats = null, stars = null, caption = '', buttons }) {
  const $ = (s) => document.querySelector(s);
  const modal = $('#modal-result');
  modal.dataset.outcome = info.outcome;
  $('#result-emblem').innerHTML = ICONS[info.outcome];
  $('#result-title').textContent = info.title;
  $('#result-sub').textContent = info.sub;
  $('#result-level').textContent = caption;

  const starsEl = $('#result-stars');
  starsEl.hidden = stars === null;
  starsEl.innerHTML = stars === null ? '' : [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');

  const statsEl = $('#result-stats');
  statsEl.hidden = !stats;
  statsEl.innerHTML = stats
    ? `<div><b>${stats.w}</b><span>فوز</span></div>
       <div><b>${stats.d}</b><span>تعادل</span></div>
       <div><b>${stats.l}</b><span>خسارة</span></div>`
    : '';

  const actions = $('#result-actions');
  actions.replaceChildren();
  for (const b of buttons) {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = `btn-${b.id}`;
    el.className = `btn ${b.primary ? 'btn-gold' : 'btn-lacquer'}`;
    el.textContent = b.label;
    el.dataset.choice = b.id;
    actions.appendChild(el);
  }

  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('open'));
  const first = actions.querySelector('.btn-gold') || actions.firstChild;
  if (first) first.focus({ preventScroll: true });

  return new Promise((resolve) => {
    actions.onclick = (e) => {
      const btn = e.target.closest('button[data-choice]');
      if (!btn) return;
      actions.onclick = null;
      modal.classList.remove('open');
      setTimeout(() => {
        modal.hidden = true;
      }, 250);
      resolve(btn.dataset.choice);
    };
  });
}
