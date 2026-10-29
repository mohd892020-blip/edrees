/** Main menu: level, board theme, piece style and sound controls. */
import { THEMES, THEME_ORDER, themePreview } from '../render/themes.js';
import { PIECES, PIECE_ORDER, OPPONENT_PIECE, piecePreview } from '../render/pieces.js';

import { LEVEL_NAMES } from './text.js';

export { LEVEL_NAMES };
const LEVEL_DESC = {
  easy: 'حركات عشوائية في الغالب — مناسب للتعلّم.',
  medium: 'يفوز إن استطاع ويمنع فوزك المباشر، وإلا يلعب عشوائياً.',
  hard: 'يحسب عدة حركات للأمام (Minimax مع Alpha-Beta).',
  expert: 'لعب مثالي محسوب لكل وضعيات اللعبة — لا يُهزم، وأفضل نتيجة ممكنة أمامه هي التعادل.',
};

function radioCard({ label, canvas, selected, onPick, group }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'card';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(selected));
  b.dataset.group = group;
  const art = document.createElement('div');
  art.className = 'card-art';
  if (canvas) art.appendChild(canvas);
  const cap = document.createElement('span');
  cap.className = 'card-label';
  cap.textContent = label;
  b.append(art, cap);
  b.addEventListener('click', onPick);
  return b;
}

function setChecked(container, btn) {
  for (const el of container.children) el.setAttribute('aria-checked', String(el === btn));
}

/** Wires the menu. `onChange(key, value)` persists and applies settings. */
export function buildMenu({ settings, onChange, sound }) {
  const $ = (s) => document.querySelector(s);

  // Difficulty.
  const levels = $('#level-picker');
  const desc = $('#level-desc');
  levels.replaceChildren();
  for (const lvl of Object.keys(LEVEL_NAMES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = LEVEL_NAMES[lvl];
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(settings.level === lvl));
    b.dataset.level = lvl;
    b.addEventListener('click', () => {
      sound.uiClick();
      setChecked(levels, b);
      desc.textContent = LEVEL_DESC[lvl];
      onChange('level', lvl);
    });
    levels.appendChild(b);
  }
  desc.textContent = LEVEL_DESC[settings.level];

  // Board themes (previews are painted progressively so the menu shows instantly).
  const themes = $('#theme-picker');
  themes.replaceChildren();
  const themeCards = THEME_ORDER.map((id) => {
    const card = radioCard({
      label: THEMES[id].name,
      selected: settings.theme === id,
      group: 'theme',
      onPick: () => {
        sound.uiClick();
        setChecked(themes, card);
        onChange('theme', id);
      },
    });
    themes.appendChild(card);
    return { id, card };
  });
  let i = 0;
  const paintNext = () => {
    if (i >= themeCards.length) return;
    const { id, card } = themeCards[i++];
    card.querySelector('.card-art').appendChild(themePreview(id, 168));
    setTimeout(paintNext, 16);
  };
  setTimeout(paintNext, 30);

  // Pieces.
  const pieces = $('#piece-picker');
  pieces.replaceChildren();
  const note = $('#ai-piece-note');
  const updateNote = (type) => {
    const opp = OPPONENT_PIECE[type];
    note.replaceChildren();
    const img = piecePreview(opp, 1, 64, 9);
    img.className = 'mini-piece';
    const span = document.createElement('span');
    span.textContent = `الكمبيوتر سيلعب بـ «${PIECES[opp].name}»`;
    note.append(img, span);
  };
  for (const type of PIECE_ORDER) {
    const card = radioCard({
      label: PIECES[type].name,
      canvas: piecePreview(type, 0, 120),
      selected: settings.piece === type,
      group: 'piece',
      onPick: () => {
        sound.uiClick();
        setChecked(pieces, card);
        updateNote(type);
        onChange('piece', type);
      },
    });
    pieces.appendChild(card);
  }
  updateNote(settings.piece);

  return bindSoundControls({ settings, onChange, sound, prefix: 'menu' });
}

/** Mute button + volume slider + music switch (used in the menu and the in-game popover). */
export function bindSoundControls({ settings, onChange, sound, prefix }) {
  const $ = (s) => document.querySelector(s);
  const mute = $(`#${prefix}-mute`);
  const vol = $(`#${prefix}-volume`);
  const val = $(`#${prefix}-volume-val`);
  const music = $(`#${prefix}-music`);
  const sync = () => {
    mute.setAttribute('aria-pressed', String(settings.muted));
    mute.classList.toggle('is-muted', settings.muted);
    mute.setAttribute('aria-label', settings.muted ? 'تشغيل الصوت' : 'كتم الصوت');
    vol.value = Math.round(settings.volume * 100);
    val.textContent = `${vol.value}%`;
    music.checked = settings.music;
  };
  mute.addEventListener('click', () => {
    sound.unlock();
    onChange('muted', !settings.muted);
    sound.uiClick();
  });
  vol.addEventListener('input', () => {
    sound.unlock();
    onChange('volume', Number(vol.value) / 100);
  });
  vol.addEventListener('change', () => sound.uiClick());
  music.addEventListener('change', () => {
    sound.unlock();
    onChange('music', music.checked);
  });
  sync();
  return sync;
}
