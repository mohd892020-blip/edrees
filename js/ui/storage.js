/** Persistent preferences and win counters (localStorage, fails gracefully). */

const KEY = 'drees:v1';
const LOOK_VERSION = 2;

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'marble',
  piece: 'pawn',
  level: 'medium',
  volume: 0.8,
  muted: false,
  music: false,
});

const emptyStats = () => ({
  easy: { w: 0, l: 0, d: 0 },
  medium: { w: 0, l: 0, d: 0 },
  hard: { w: 0, l: 0, d: 0 },
  expert: { w: 0, l: 0, d: 0 },
});

export function loadData() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    raw = null;
  }
  const stats = emptyStats();
  if (raw && raw.stats) {
    for (const lvl of Object.keys(stats)) {
      const s = raw.stats[lvl];
      if (s) for (const k of ['w', 'l', 'd']) stats[lvl][k] = Number(s[k]) || 0;
    }
  }
  const campaign = { stars: {} };
  if (raw && raw.campaign && raw.campaign.stars) {
    for (const [id, n] of Object.entries(raw.campaign.stars)) {
      const v = Math.max(0, Math.min(3, Number(n) || 0));
      if (v) campaign.stars[id] = v;
    }
  }
  const settings = { ...DEFAULT_SETTINGS, ...(raw && raw.settings) };
  // One-time move to the current look; players can pick anything again afterwards.
  if (settings.look !== LOOK_VERSION) {
    settings.theme = DEFAULT_SETTINGS.theme;
    settings.piece = DEFAULT_SETTINGS.piece;
    settings.look = LOOK_VERSION;
  }
  return { settings, stats, campaign };
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode or storage full — keep playing without persistence */
  }
}

export function totals(stats) {
  return Object.values(stats).reduce(
    (acc, s) => ({ w: acc.w + s.w, l: acc.l + s.l, d: acc.d + s.d }),
    { w: 0, l: 0, d: 0 },
  );
}
