/**
 * Procedural sound effects — everything is synthesized with the Web Audio API,
 * no audio files are loaded.
 *
 * Graph: [sfx bus] ─┐
 *        [music bus]┼─> master gain ─> compressor ─> destination
 *        [reverb]  ─┘
 */

const now = (ctx) => ctx.currentTime;
const rand = (a, b) => a + Math.random() * (b - a);

export class SoundEngine {
  constructor({ volume = 0.8, muted = false } = {}) {
    this.ctx = null;
    this.volume = volume;
    this.muted = muted;
    this.surface = 'wood';
    this._drag = null;
  }

  /** Must be called from a user gesture (browsers keep audio locked until then). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.master.connect(this.compressor).connect(ctx.destination);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(2.2, 2.8);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.32;
      this.reverbSend.connect(this.reverb).connect(this.master);

      this.noiseBuffer = this._makeNoise(2);
      this._applyVolume(true);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._applyVolume();
  }

  setMuted(m) {
    this.muted = !!m;
    this._applyVolume();
  }

  setSurface(surface) {
    this.surface = surface;
  }

  _applyVolume(immediate = false) {
    if (!this.ctx) return;
    const target = this.muted ? 0 : this.volume * this.volume; // perceptual curve
    if (immediate) this.master.gain.value = target;
    else this.master.gain.setTargetAtTime(target, now(this.ctx), 0.03);
  }

  // ───────────────────────── primitives ─────────────────────────

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Oscillator with an attack/decay envelope. */
  tone({
    t = now(this.ctx), freq = 440, freqEnd = null, type = 'sine', dur = 0.2, gain = 0.3,
    attack = 0.005, dest = this.sfx, detune = 0, reverb = 0, curve = 'exp',
  }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = detune;
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.reverbSend);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return { osc, gain: g };
  }

  /** Filtered noise burst. */
  noise({
    t = now(this.ctx), dur = 0.05, gain = 0.3, type = 'bandpass', freq = 1500, freqEnd = null,
    Q = 1, attack = 0.002, dest = this.sfx, reverb = 0,
  }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.reverbSend);
    }
    const offset = Math.random() * Math.max(0, this.noiseBuffer.duration - dur - 0.1);
    src.start(t, offset, dur + 0.05);
    return src;
  }

  /** A short-lived filter chain that colours sounds by the board surface. */
  _surfaceChain(t) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    const cut = { wood: 7000, marble: 14000, sand: 1500, asphalt: 9000, glass: 16000 }[this.surface] || 9000;
    f.frequency.value = cut;
    f.connect(this.sfx);
    setTimeout(() => f.disconnect(), 1500);
    return f;
  }

  // ───────────────────────── game sounds ─────────────────────────

  uiClick() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    this.tone({ t, freq: 1650, freqEnd: 1250, dur: 0.05, gain: 0.08 });
    this.noise({ t, dur: 0.02, gain: 0.06, type: 'highpass', freq: 3000 });
  }

  select() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    this.tone({ t, freq: 660, freqEnd: 990, dur: 0.12, gain: 0.07, type: 'triangle' });
  }

  pickup() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    this.noise({ t, dur: 0.16, gain: 0.16, freq: 500, freqEnd: 2600, Q: 1.2, attack: 0.03 });
    this.tone({ t, freq: 320, freqEnd: 520, dur: 0.12, gain: 0.04, type: 'sine' });
  }

  whoosh() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    this.noise({ t, dur: 0.32, gain: 0.12, freq: 1800, freqEnd: 500, Q: 0.9, attack: 0.08 });
  }

  /** Continuous "sliding through the air" noise while dragging; volume follows speed. */
  dragStart() {
    if (!this.ctx || this._drag) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    this._drag = { src, f, g };
  }

  dragUpdate(speed) {
    if (!this._drag) return;
    const t = now(this.ctx);
    const v = Math.min(1, speed / 2500);
    this._drag.g.gain.setTargetAtTime(v * 0.11, t, 0.05);
    this._drag.f.frequency.setTargetAtTime(600 + v * 2200, t, 0.05);
  }

  dragStop() {
    if (!this._drag) return;
    const { src, g } = this._drag;
    const t = now(this.ctx);
    g.gain.setTargetAtTime(0, t, 0.04);
    src.stop(t + 0.25);
    this._drag = null;
  }

  /** Piece landing sound — depends on the piece material and board surface. */
  place(type, intensity = 1) {
    if (!this.ctx) return;
    const t = now(this.ctx) + 0.005;
    const out = this._surfaceChain(t);
    const k = intensity;
    const soft = this.surface === 'sand';
    const bounce = soft ? 0.25 : 1;

    switch (type) {
      case 'stone': {
        this.noise({ t, dur: 0.03, gain: 0.85 * k, freq: 2600, Q: 1.3, dest: out });
        this.tone({ t, freq: 170, freqEnd: 85, dur: 0.09, gain: 0.45 * k, dest: out });
        this.noise({ t: t + 0.075, dur: 0.02, gain: 0.3 * k * bounce, freq: 3200, Q: 1.5, dest: out });
        this.noise({ t: t + 0.12, dur: 0.015, gain: 0.12 * k * bounce, freq: 3600, Q: 1.5, dest: out });
        break;
      }
      case 'butt': {
        this.noise({ t, dur: 0.06, gain: 0.5 * k, type: 'lowpass', freq: 800, Q: 0.6, dest: out });
        this.tone({ t, freq: 120, freqEnd: 70, dur: 0.06, gain: 0.22 * k, dest: out });
        this.noise({ t: t + 0.06, dur: 0.03, gain: 0.1 * k * bounce, type: 'lowpass', freq: 1100, dest: out });
        break;
      }
      case 'stick': {
        this.noise({ t, dur: 0.02, gain: 0.45 * k, freq: 1600, Q: 2, dest: out });
        this.tone({ t, freq: 760, freqEnd: 720, dur: 0.1, gain: 0.32 * k, dest: out });
        this.tone({ t, freq: 1240, dur: 0.05, gain: 0.14 * k, dest: out });
        this.noise({ t: t + 0.035, dur: 0.02, gain: 0.25 * k, freq: 1900, Q: 2, dest: out });
        this.tone({ t: t + 0.035, freq: 980, dur: 0.06, gain: 0.12 * k, dest: out });
        this.noise({ t: t + 0.09, dur: 0.015, gain: 0.12 * k * bounce, freq: 2100, Q: 2, dest: out });
        break;
      }
      case 'cap': {
        const metal = (tt, g, len) => {
          for (const [f, a] of [[2950, 1], [4420, 0.7], [6130, 0.5], [7810, 0.35]]) {
            this.tone({ t: tt, freq: f * rand(0.98, 1.02), dur: len * rand(0.6, 1), gain: 0.09 * g * a, dest: out, reverb: 0.15 });
          }
          this.noise({ t: tt, dur: 0.012, gain: 0.35 * g, type: 'highpass', freq: 4000, dest: out });
        };
        metal(t, k, 0.32);
        const wobble = [0.07, 0.125, 0.17, 0.205, 0.23];
        wobble.forEach((dt, i) => metal(t + dt, k * bounce * 0.45 * (1 - i / wobble.length), 0.08));
        break;
      }
      case 'pit': {
        this.noise({ t, dur: 0.02, gain: 0.7 * k, freq: 3200, Q: 3, dest: out });
        this.tone({ t, freq: 1260, freqEnd: 1080, dur: 0.045, gain: 0.25 * k, dest: out });
        this.noise({ t: t + 0.06, dur: 0.015, gain: 0.32 * k * bounce, freq: 3500, Q: 3, dest: out });
        this.noise({ t: t + 0.1, dur: 0.012, gain: 0.14 * k * bounce, freq: 3800, Q: 3, dest: out });
        break;
      }
      default:
        this.noise({ t, dur: 0.03, gain: 0.5 * k, freq: 2000, dest: out });
    }

    // Surface character.
    if (this.surface === 'sand') {
      this.noise({ t, dur: 0.18, gain: 0.22 * k, type: 'lowpass', freq: 2600, attack: 0.01, dest: this.sfx });
    } else if (this.surface === 'wood') {
      this.tone({ t, freq: 210, freqEnd: 180, dur: 0.12, gain: 0.12 * k, dest: this.sfx });
    } else if (this.surface === 'glass') {
      this.tone({ t, freq: 2640, dur: 0.25, gain: 0.03 * k, dest: this.sfx, reverb: 0.4 });
    } else if (this.surface === 'asphalt') {
      this.noise({ t, dur: 0.05, gain: 0.12 * k, type: 'highpass', freq: 2500, dest: this.sfx });
    } else if (this.surface === 'marble') {
      this.tone({ t, freq: 1900, dur: 0.06, gain: 0.05 * k, dest: this.sfx, reverb: 0.3 });
    }
  }

  error() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(this.sfx);
    this.tone({ t, freq: 196, dur: 0.1, gain: 0.13, type: 'square', dest: lp, curve: 'lin' });
    this.tone({ t: t + 0.12, freq: 147, dur: 0.16, gain: 0.13, type: 'square', dest: lp, curve: 'lin' });
    setTimeout(() => lp.disconnect(), 800);
  }

  /** Suspense drum roll for the toss; returns the AudioContext time at which it peaks. */
  drumroll(duration = 2.4) {
    if (!this.ctx) return 0;
    const t0 = now(this.ctx) + 0.03;
    // Snare roll with crescendo and accelerating strokes.
    let t = 0;
    while (t < duration - 0.05) {
      const p = t / duration;
      const gap = 0.075 - 0.045 * p;
      this.noise({ t: t0 + t, dur: 0.06, gain: 0.05 + 0.3 * p * p, freq: 1900, Q: 0.7, reverb: 0.1 });
      t += gap * rand(0.9, 1.1);
    }
    // Low toms accelerating (darbuka "dum").
    const toms = [0, 0.55, 1.0, 1.35, 1.62, 1.84, 2.0, 2.12, 2.22, 2.3];
    for (const tt of toms) {
      const at = (tt / 2.4) * duration;
      if (at >= duration) continue;
      this.tone({ t: t0 + at, freq: 140, freqEnd: 70, dur: 0.22, gain: 0.35 + 0.3 * (at / duration) });
    }
    return t0 + duration;
  }

  /** The toss result hit: boom + crash + bright sting. */
  tossLand() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    this.tone({ t, freq: 90, freqEnd: 38, dur: 0.7, gain: 0.8 });
    this.noise({ t, dur: 1.4, gain: 0.22, type: 'highpass', freq: 5200, attack: 0.004, reverb: 0.5 });
    for (const f of [587.33, 739.99, 880, 1174.66]) {
      this.tone({ t: t + 0.02, freq: f, dur: 1.1, gain: 0.05, type: 'triangle', reverb: 0.6 });
    }
  }

  coinFlip() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    for (const [f, a] of [[3150, 1], [4720, 0.6], [6900, 0.4]]) {
      this.tone({ t, freq: f, dur: 0.6, gain: 0.06 * a, reverb: 0.4 });
    }
  }

  /** Short suspense cue when someone is one move away from winning. */
  tension(againstHuman = true) {
    if (!this.ctx) return;
    const t = now(this.ctx);
    // Heartbeat.
    for (const [dt, g] of [[0, 0.55], [0.22, 0.4], [0.9, 0.5], [1.12, 0.35]]) {
      this.tone({ t: t + dt, freq: 62, freqEnd: 42, dur: 0.2, gain: g });
    }
    // Tremolo strings.
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 9;
    lfoGain.gain.value = 0.5;
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    lfo.connect(lfoGain).connect(amp.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.9;
    amp.connect(bp).connect(this.sfx);
    const notes = againstHuman ? [293.66, 311.13, 440] : [293.66, 369.99, 440];
    for (const f of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.7);
      o.connect(g).connect(amp);
      o.start(t);
      o.stop(t + 1.8);
    }
    lfo.start(t);
    lfo.stop(t + 1.8);
    setTimeout(() => bp.disconnect(), 2200);
  }

  /** A soft gong when the movement phase begins. */
  phaseChange() {
    if (!this.ctx) return;
    const t = now(this.ctx);
    for (const [f, a] of [[196, 1], [392.4, 0.5], [588, 0.3], [1046, 0.12]]) {
      this.tone({ t, freq: f, dur: 1.6, gain: 0.09 * a, attack: 0.01, reverb: 0.5 });
    }
  }

  win() {
    if (!this.ctx) return;
    const t = now(this.ctx) + 0.05;
    const brass = (tt, f, dur, g) => {
      const ctx = this.ctx;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(800, tt);
      lp.frequency.linearRampToValueAtTime(3200, tt + 0.08);
      lp.frequency.exponentialRampToValueAtTime(1200, tt + dur);
      lp.connect(this.sfx);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      lp.connect(send).connect(this.reverbSend);
      this.tone({ t: tt, freq: f, dur, gain: g, type: 'sawtooth', attack: 0.03, dest: lp });
      this.tone({ t: tt, freq: f, dur, gain: g * 0.6, type: 'sawtooth', detune: 9, attack: 0.03, dest: lp });
      setTimeout(() => lp.disconnect(), (tt - this.ctx.currentTime + dur + 0.5) * 1000);
    };
    const seq = [[0, 293.66], [0.13, 369.99], [0.26, 440], [0.39, 587.33]];
    for (const [dt, f] of seq) brass(t + dt, f, 0.28, 0.07);
    for (const f of [293.66, 369.99, 440, 587.33, 739.99]) brass(t + 0.58, f, 1.6, 0.045);
    // Sparkle.
    for (let i = 0; i < 14; i++) {
      this.tone({ t: t + 0.6 + i * 0.07, freq: rand(1800, 4200), dur: 0.3, gain: 0.025, reverb: 0.6 });
    }
    // Darbuka flourish.
    for (const [dt, kind] of [[0.58, 'd'], [0.78, 't'], [0.88, 't'], [0.98, 'd'], [1.18, 't']]) {
      if (kind === 'd') this.tone({ t: t + dt, freq: 130, freqEnd: 65, dur: 0.25, gain: 0.45 });
      else this.noise({ t: t + dt, dur: 0.05, gain: 0.25, freq: 3800, Q: 1.2 });
    }
  }

  lose() {
    if (!this.ctx) return;
    const t = now(this.ctx) + 0.05;
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    lp.connect(send).connect(this.reverbSend);
    const seq = [[0, 440], [0.32, 392], [0.64, 369.99], [0.96, 311.13], [1.3, 293.66]];
    seq.forEach(([dt, f], i) => {
      const last = i === seq.length - 1;
      this.tone({ t: t + dt, freq: f, freqEnd: last ? f * 0.97 : null, dur: last ? 1.4 : 0.3, gain: 0.09, type: 'triangle', attack: 0.02, dest: lp });
      this.tone({ t: t + dt, freq: f / 2, dur: last ? 1.4 : 0.3, gain: 0.05, type: 'sawtooth', attack: 0.02, dest: lp });
    });
    this.tone({ t: t + 1.3, freq: 73.42, dur: 1.6, gain: 0.25 });
    setTimeout(() => lp.disconnect(), 4000);
  }

  draw() {
    if (!this.ctx) return;
    const t = now(this.ctx) + 0.05;
    for (const [dt, f] of [[0, 392], [0.25, 293.66], [0.5, 440]]) {
      this.tone({ t: t + dt, freq: f, dur: 0.9, gain: 0.07, type: 'triangle', attack: 0.02, reverb: 0.5 });
    }
    for (const f of [293.66, 392, 440]) {
      this.tone({ t: t + 0.8, freq: f, dur: 1.4, gain: 0.04, type: 'sine', attack: 0.1, reverb: 0.6 });
    }
  }
}
