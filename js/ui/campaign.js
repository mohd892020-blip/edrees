/** Campaign map ("رحلة دريس") and the stage intro dialog. */
import { CHAPTERS, KIND_NAMES, MAX_STARS } from '../campaign/stages.js';
import { starsOf, stageUnlocked, chapterUnlocked, chapterStars, totalStars, currentStageId } from '../campaign/progress.js';
import { themePreview } from '../render/themes.js';
import { movesPhrase, LEVEL_NAMES } from './text.js';

const $ = (s) => document.querySelector(s);

export function goalText(stage) {
  const g = stage.goal;
  if (g.type === 'survive') return `لا تخسر خلال ${movesPhrase(g.moves)}`;
  if (g.limit) return g.limit === 1 ? 'افُز بحركة واحدة' : `افُز خلال ${movesPhrase(g.limit)}`;
  return 'افُز بالمباراة';
}

export function bonusText(stage) {
  const b = stage.bonus || {};
  if (b.type === 'par') return `الفوز خلال ${movesPhrase(b.moves)}`;
  if (b.type === 'win') return `هزيمة ${stage.boss || 'الخصم'}`;
  return 'من المحاولة الأولى';
}

export function opponentText(stage) {
  const lvl = LEVEL_NAMES[stage.opponent];
  const name = stage.boss || 'الكمبيوتر';
  return stage.opponent === 'expert' ? `${name} · ${lvl} (لعب مثالي)` : `${name} · ${lvl}`;
}

const starRow = (n) => [0, 1, 2].map((i) => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');

const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor"/></svg>';

/** Renders the chapter list; `onPick(stageId)` fires for unlocked stages. */
export function renderCampaign(progress, onPick) {
  const list = $('#chapter-list');
  list.replaceChildren();
  const current = currentStageId(progress);
  $('#campaign-stars').textContent = `${totalStars(progress)} من ${MAX_STARS}`;

  CHAPTERS.forEach((chapter, ci) => {
    const open = chapterUnlocked(progress, ci);
    const art = document.createElement('article');
    art.className = `chapter${open ? '' : ' locked'}`;
    const max = chapter.stages.length * 3;
    art.innerHTML = `
      <div class="chapter-banner">
        <div>
          <div class="chapter-num">الفصل ${ci + 1}</div>
          <h3>${chapter.title}</h3>
          <span class="chip rule-chip">${chapter.rule}</span>
        </div>
        <div class="chapter-stars">${open ? `<span class="star">★</span> ${chapterStars(progress, ci)} من ${max}` : '<span class="chapter-lock">أكمل زعيم الفصل السابق</span>'}</div>
      </div>
      <ol class="stage-path"></ol>`;
    art.querySelector('.chapter-banner').prepend(themePreview(chapter.theme, 560));
    const path = art.querySelector('.stage-path');

    chapter.stages.forEach((stage, si) => {
      const unlocked = stageUnlocked(progress, ci, si);
      const stars = starsOf(progress, stage.id);
      const li = document.createElement('li');
      if (stars) li.classList.add('reached');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stage-node';
      btn.dataset.stage = stage.id;
      if (stage.kind === 'boss') btn.classList.add('boss');
      if (stars) btn.classList.add('done');
      if (stage.id === current) btn.classList.add('current');
      btn.disabled = !unlocked;
      btn.innerHTML = !unlocked ? LOCK : stage.kind === 'boss' ? CROWN : String(si + 1);
      btn.setAttribute('aria-label', `${KIND_NAMES[stage.kind]}: ${stage.title}${unlocked ? '' : ' (مقفلة)'}`);
      btn.addEventListener('click', () => onPick(stage.id));
      li.innerHTML = `<span class="stage-kind-mini">${KIND_NAMES[stage.kind]}</span>`;
      li.append(btn);
      const label = document.createElement('span');
      label.className = 'stage-label';
      label.textContent = stage.title;
      const st = document.createElement('span');
      st.className = 'node-stars';
      st.innerHTML = starRow(stars);
      li.append(label, st);
      path.appendChild(li);
    });
    list.appendChild(art);
  });

  const cur = current && list.querySelector(`[data-stage="${current}"]`);
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/** Stage intro dialog. Resolves true to start, false to go back. */
export function stageDialog({ stage, chapter, bestStars }) {
  const modal = $('#modal-stage');
  $('#stage-kind').textContent = KIND_NAMES[stage.kind];
  $('#stage-title').textContent = stage.title;
  $('#stage-desc').textContent = stage.desc;
  $('#stage-goal').textContent = goalText(stage);
  $('#stage-rule').textContent = `${chapter.rule} — ${chapter.ruleDesc}`;
  $('#stage-opp').textContent = opponentText(stage);
  const criteria = [goalText(stage), 'دون استخدام التلميح', bonusText(stage)];
  $('#stage-stars').innerHTML = criteria
    .map((c, i) => `<li class="${i < bestStars ? 'got' : ''}"><span class="star">★</span>${c}</li>`)
    .join('');
  $('#btn-stage-start').textContent = bestStars ? 'العب مجدداً' : 'ابدأ';
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('open'));
  $('#btn-stage-start').focus({ preventScroll: true });
  return new Promise((resolve) => {
    const close = (v) => () => {
      modal.classList.remove('open');
      setTimeout(() => {
        modal.hidden = true;
      }, 220);
      $('#btn-stage-start').onclick = null;
      $('#btn-stage-cancel').onclick = null;
      resolve(v);
    };
    $('#btn-stage-start').onclick = close(true);
    $('#btn-stage-cancel').onclick = close(false);
  });
}
