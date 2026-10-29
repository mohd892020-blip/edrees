/** Animated coin toss deciding who starts. */

function randomBit() {
  if (window.crypto && crypto.getRandomValues) {
    const a = new Uint8Array(1);
    crypto.getRandomValues(a);
    return a[0] & 1;
  }
  return Math.random() < 0.5 ? 0 : 1;
}

/**
 * Plays the toss and resolves with the starter (0 = local human, 1 = computer).
 * `forced` lets a host (e.g. future online play) impose the result.
 */
export async function runToss({ sound, humanImg, aiImg, forced = null }) {
  const $ = (s) => document.querySelector(s);
  const coin = $('#coin');
  const lift = $('#coin-lift');
  const shadow = $('#coin-shadow');
  const result = $('#toss-result');
  const sub = $('#toss-sub');
  const go = $('#btn-toss-go');
  $('#coin-front-img').replaceChildren(humanImg);
  $('#coin-back-img').replaceChildren(aiImg);
  result.textContent = '';
  result.className = 'toss-result';
  sub.textContent = 'من سيبدأ؟';
  go.hidden = true;

  const starter = forced === null ? randomBit() : forced;
  const turns = 7 + Math.floor(Math.random() * 3);
  const final = turns * 360 + (starter === 0 ? 0 : 180);
  const D = 2500;

  await new Promise((r) => setTimeout(r, 350));
  sound.coinFlip();
  sound.drumroll(D / 1000);
  const spin = coin.animate(
    [{ transform: 'rotateX(0deg)' }, { transform: `rotateX(${final}deg)` }],
    { duration: D, easing: 'cubic-bezier(.12,.62,.28,1)', fill: 'forwards' },
  );
  lift.animate(
    [
      { transform: 'translateY(0) scale(1)', easing: 'cubic-bezier(.2,.75,.35,1)' },
      { transform: 'translateY(-34vh) scale(1.15)', offset: 0.46, easing: 'cubic-bezier(.55,0,.8,.4)' },
      { transform: 'translateY(0) scale(1)' },
    ],
    { duration: D, fill: 'forwards' },
  );
  shadow.animate(
    [
      { transform: 'scale(1)', opacity: 0.55 },
      { transform: 'scale(0.45)', opacity: 0.15, offset: 0.46 },
      { transform: 'scale(1)', opacity: 0.55 },
    ],
    { duration: D, fill: 'forwards' },
  );
  await spin.finished;
  sound.tossLand();
  lift.animate(
    [{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)' }, { transform: 'translateY(0)' }],
    { duration: 320, easing: 'ease-out' },
  );
  result.textContent = starter === 0 ? 'أنت تبدأ!' : 'الكمبيوتر يبدأ';
  result.classList.add('show', starter === 0 ? 'is-you' : 'is-ai');
  sub.textContent = starter === 0 ? 'ستصفّ قطعك الثلاث أولاً، ثم تبدأ التحريك' : 'سيصفّ الكمبيوتر قطعه أولاً ويبدأ التحريك';
  go.hidden = false;
  go.focus({ preventScroll: true });

  await new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      go.removeEventListener('click', done);
      resolve();
    };
    const timer = setTimeout(done, 3200);
    go.addEventListener('click', done);
  });
  return starter;
}
