/** The coin toss deciding who starts: played in the 3D world when available. */
import { piecePreview } from '../render/pieces.js';

const EDGE_LAYERS = 12;

function randomBit() {
  if (window.crypto && crypto.getRandomValues) {
    const a = new Uint8Array(1);
    crypto.getRandomValues(a);
    return a[0] & 1;
  }
  return Math.random() < 0.5 ? 0 : 1;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** CSS coin for browsers without WebGL. */
async function cssCoin(starter, sound, onLand) {
  const $ = (s) => document.querySelector(s);
  const coin = $('#coin');
  const lift = $('#coin-lift');
  const shadow = $('#coin-shadow');
  const edge = $('#coin-edge');
  if (!edge.childElementCount) {
    for (let i = 0; i < EDGE_LAYERS; i++) {
      const layer = document.createElement('i');
      layer.style.setProperty('--i', String(i));
      edge.appendChild(layer);
    }
  }
  for (const el of [coin, lift, shadow]) el.getAnimations().forEach((a) => a.cancel());
  const turns = 6 + Math.floor(Math.random() * 3);
  const final = 18 + turns * 360 + (starter === 0 ? 0 : 180);
  const D = 2600;
  const rise = Math.max(90, Math.min(window.innerHeight * 0.34, lift.getBoundingClientRect().top - 10));
  sound.coinFlip();
  sound.drumroll(D / 1000);
  const spin = coin.animate(
    [{ transform: 'rotateX(18deg)' }, { transform: `rotateX(${final}deg)` }],
    { duration: D, easing: 'cubic-bezier(.15,.55,.3,1)', fill: 'forwards' },
  );
  lift.animate(
    [
      { transform: 'translateY(0) scale(1)', easing: 'cubic-bezier(.2,.75,.35,1)' },
      { transform: `translateY(${-rise}px) scale(1.12)`, offset: 0.46, easing: 'cubic-bezier(.55,0,.8,.4)' },
      { transform: 'translateY(0) scale(1)' },
    ],
    { duration: D, fill: 'forwards' },
  );
  await spin.finished;
  sound.tossLand();
  onLand();
}

/**
 * Plays the toss and resolves with the starter (0 = local player, 1 = opponent).
 * `pieces` are the two piece types, `names` the two display names and `world`
 * the renderer. `forced` lets a host (e.g. online play) impose the result.
 */
export async function runToss({ sound, pieces, names = ['أنت', 'الكمبيوتر'], forced = null, world = null }) {
  const $ = (s) => document.querySelector(s);
  const result = $('#toss-result');
  const sub = $('#toss-sub');
  const go = $('#btn-toss-go');
  const progress = $('#toss-progress');
  const cards = [$('#toss-p0'), $('#toss-p1')];

  $('#coin-front-img').replaceChildren(piecePreview(pieces[0], 0, 140, 21));
  $('#coin-back-img').replaceChildren(piecePreview(pieces[1], 1, 140, 22));
  $('#toss-p0-img').replaceChildren(piecePreview(pieces[0], 0, 96, 41));
  $('#toss-p1-img').replaceChildren(piecePreview(pieces[1], 1, 96, 42));
  $('#toss-p1-name').textContent = names[1];
  $('#coin-back-label').textContent = names[1];

  progress.getAnimations().forEach((a) => a.cancel());
  cards.forEach((c) => c.classList.remove('is-winner', 'is-loser'));
  result.textContent = '';
  result.className = 'toss-result';
  sub.textContent = 'من يبدأ الصفّ؟';
  go.hidden = true;

  const starter = forced === null ? randomBit() : forced;

  const reveal = () => {
    cards[starter].classList.add('is-winner');
    cards[1 - starter].classList.add('is-loser');
    result.textContent = starter === 0 ? 'أنت تبدأ!' : `${names[1]} يبدأ`;
    result.classList.add('show', starter === 0 ? 'is-you' : 'is-ai');
    sub.textContent = starter === 0
      ? 'ستصفّ قطعك الثلاث أولاً، ثم تبدأ التحريك'
      : `سيصفّ ${names[1]} قطعه أولاً ويبدأ التحريك`;
  };

  if (world && world.is3D) {
    await wait(900); // the camera settles on the board first
    sound.coinFlip();
    sound.drumroll(2.45);
    await world.playToss(starter, names, () => {
      sound.tossLand();
      reveal();
    });
  } else {
    await wait(350);
    await cssCoin(starter, sound, reveal);
  }

  go.hidden = false;
  go.focus({ preventScroll: true });

  // Starts by itself after a few seconds; the bar on the button shows the countdown.
  const countdown = progress.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
    duration: 3400, easing: 'linear', fill: 'forwards',
  });
  await new Promise((resolve) => {
    const done = () => {
      go.removeEventListener('click', done);
      countdown.onfinish = null;
      resolve();
    };
    countdown.onfinish = done;
    go.addEventListener('click', done);
  });
  if (world && world.is3D) world.hideCoin();
  return starter;
}
