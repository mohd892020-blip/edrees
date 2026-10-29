/**
 * Calm generative background music: a soft drone plus sparse oud-like plucks
 * in maqam Bayati (with its characteristic quarter-tone E), synthesized with
 * Karplus-Strong string buffers. No audio files.
 */

const BAYATI = [
  146.83, // D3
  160.12, // E half-flat 3
  174.61, // F3
  196.0, // G3
  220.0, // A3
  233.08, // Bb3
  261.63, // C4
  293.66, // D4
  320.24, // E half-flat 4
  349.23, // F4
  392.0, // G4
  440.0, // A4
];

const BEAT = 60 / 66; // seconds per beat

export class Music {
  constructor(engine) {
    this.engine = engine;
    this.playing = false;
    this.buffers = null;
    this.timer = null;
    this.nextTime = 0;
    this.degree = 7;
    this.bar = 0;
  }

  _pluck(freq) {
    const ctx = this.engine.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.2);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const period = Math.round(sr / freq);
    // Soft excitation (low-passed noise) → warmer, oud-like attack.
    let prev = 0;
    for (let i = 0; i < period; i++) {
      const n = Math.random() * 2 - 1;
      prev = prev * 0.55 + n * 0.45;
      d[i] = prev;
    }
    const damp = 0.4985;
    for (let i = period; i < len; i++) d[i] = (d[i - period] + d[i - period + 1]) * damp;
    // Fade the tail so long low notes never end with a click.
    const fade = Math.floor(sr * 0.5);
    for (let i = 0; i < fade; i++) d[len - fade + i] *= 1 - i / fade;
    return buf;
  }

  _ensureBuffers() {
    if (this.buffers) return;
    this.buffers = BAYATI.map((f) => this._pluck(f));
  }

  start() {
    const e = this.engine;
    if (!e.ctx || this.playing) return;
    this._ensureBuffers();
    this.playing = true;
    const ctx = e.ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    this.out.connect(e.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    this.out.connect(send).connect(e.reverbSend);

    // Drone: D2 + A2 through a slowly breathing low-pass filter.
    this.drone = [];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.5;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    lp.connect(droneGain).connect(this.out);
    for (const [f, type, det] of [[73.42, 'triangle', 0], [110, 'sine', 0], [73.42, 'sawtooth', 7]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = type === 'sawtooth' ? 0.25 : 1;
      o.connect(g).connect(lp);
      o.start();
      this.drone.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    this.drone.push(lfo);

    this.nextTime = ctx.currentTime + 0.4;
    this.timer = setInterval(() => this._schedule(), 120);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const ctx = this.engine.ctx;
    const out = this.out;
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const drone = this.drone;
    setTimeout(() => {
      drone.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      });
      out.disconnect();
    }, 2500);
  }

  _note(t, degree, gain = 0.5) {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[degree];
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = (Math.random() - 0.5) * 0.5;
      src.connect(g).connect(pan).connect(this.out);
    } else src.connect(g).connect(this.out);
    src.start(t);
  }

  _schedule() {
    const ctx = this.engine.ctx;
    while (this.nextTime < ctx.currentTime + 0.6) {
      this._phraseStep(this.nextTime);
    }
  }

  /** One rhythmic step of a gentle random-walk melody that keeps returning home to D. */
  _phraseStep(t) {
    const r = Math.random();
    let dur;
    if (r < 0.15) {
      dur = BEAT * 2; // rest
    } else {
      const step = [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)];
      this.degree = Math.max(0, Math.min(BAYATI.length - 1, this.degree + step));
      if (Math.random() < 0.12) this.degree = 7; // gravitate to the tonic
      this._note(t, this.degree, 0.32 + Math.random() * 0.12);
      // Ornament: quick grace note (very oud-like).
      if (Math.random() < 0.18 && this.degree > 0) this._note(t - 0.07, this.degree - 1, 0.12);
      dur = BEAT * [0.5, 1, 1, 1.5, 2][Math.floor(Math.random() * 5)];
    }
    // Every few bars, a soft low "dum" of a frame drum.
    this.bar += dur / (BEAT * 4);
    if (this.bar >= 2) {
      this.bar -= 2;
      this.engine.tone({ t, freq: 95, freqEnd: 55, dur: 0.5, gain: 0.09, dest: this.out });
      this._note(t, 0, 0.18);
    }
    this.nextTime = t + dur;
  }
}
