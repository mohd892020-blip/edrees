/** Post-game review dialog: every decision of the player against perfect play. */
import { BLOCKED } from '../core/rules.js';
import { CELL_NAMES } from './text.js';

const $ = (s) => document.querySelector(s);

const VERDICTS = {
  best: { label: 'ممتازة', why: '' },
  slow: { label: 'فوز أبطأ', why: 'ما زلت فائزاً، لكن كان هناك طريق أقصر.' },
  'missed-win': { label: 'فرصة ضائعة', why: 'كان الفوز مضموناً لك، وبعد هذه الحركة لم يعد كذلك.' },
  blunder: { label: 'خطأ قاتل', why: 'بعد هذه الحركة يستطيع الخصم الفوز مهما فعلت.' },
};

function describe(action) {
  return action.type === 'place'
    ? `وضعت قطعة في ${CELL_NAMES[action.to]}.`
    : `نقلت قطعة من ${CELL_NAMES[action.from]} إلى ${CELL_NAMES[action.to]}.`;
}

function suggest(best) {
  return best.type === 'place'
    ? `الأفضل: الوضع في ${CELL_NAMES[best.to]}.`
    : `الأفضل: النقل من ${CELL_NAMES[best.from]} إلى ${CELL_NAMES[best.to]}.`;
}

function miniBoard(item) {
  const grid = document.createElement('div');
  grid.className = 'mini-board';
  grid.setAttribute('aria-hidden', 'true');
  item.board.forEach((v, i) => {
    const c = document.createElement('i');
    if (v === 0) c.classList.add('me');
    else if (v === 1) c.classList.add('op');
    else if (v === BLOCKED) c.classList.add('x');
    if (item.action.from === i) c.classList.add('from');
    if (item.action.to === i) c.classList.add('to');
    if (item.best && item.best.to === i) c.classList.add('best');
    grid.appendChild(c);
  });
  return grid;
}

/** Shows the review; resolves when closed. */
export function showAnalysis(review) {
  const modal = $('#modal-analysis');
  const { summary, items } = review;
  const chips = [`<span class="chip">قرارات مثالية: ${summary.best} من ${summary.total}</span>`];
  if (summary.missedWins) chips.push(`<span class="chip">فرص ضائعة: ${summary.missedWins}</span>`);
  if (summary.blunders) chips.push(`<span class="chip">أخطاء قاتلة: ${summary.blunders}</span>`);
  if (summary.slow) chips.push(`<span class="chip">انتصارات أبطأ: ${summary.slow}</span>`);
  $('#analysis-summary').innerHTML = chips.join('');

  const list = $('#analysis-list');
  list.replaceChildren();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'an-item';
    li.textContent = 'لم تتخذ أي قرار في هذه المباراة.';
    list.appendChild(li);
  }
  for (const item of items) {
    const v = VERDICTS[item.verdict];
    const li = document.createElement('li');
    li.className = `an-item v-${item.verdict}`;
    const text = document.createElement('div');
    text.className = 'an-text';
    text.innerHTML = `
      <div class="an-head"><b>القرار ${item.index} · ${item.action.type === 'place' ? 'صفّ' : 'تحريك'}</b>
        <span class="verdict ${item.verdict}">${v.label}</span></div>
      <p>${describe(item.action)} ${v.why}</p>
      ${item.best ? `<p class="better">${suggest(item.best)}</p>` : ''}`;
    li.append(miniBoard(item), text);
    list.appendChild(li);
  }

  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('open'));
  list.scrollTop = 0;
  // Jump to the first mistake, if any.
  const firstBad = list.querySelector('.v-blunder, .v-missed-win');
  if (firstBad) setTimeout(() => firstBad.scrollIntoView({ block: 'center' }), 50);
  return new Promise((resolve) => {
    $('#btn-analysis-close').onclick = () => {
      modal.classList.remove('open');
      setTimeout(() => {
        modal.hidden = true;
      }, 220);
      $('#btn-analysis-close').onclick = null;
      resolve();
    };
  });
}
