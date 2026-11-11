/**
 * Hush audio engine
 * -----------------
 * A small, dependency-free wrapper around the Web Audio API.
 *
 * Every "layer" is a live synthesis graph built by a sound definition. Nothing
 * is streamed or decoded, so a layer loops forever without seams, gaps or
 * network requests, and the whole mixer costs a few kilobytes.
 */

window.Hush = window.Hush || {};

const NOISE_SECONDS = 8;

/* ------------------------------------------------------------------ */
/* generators                                                          */
/* ------------------------------------------------------------------ */

function normalize(data, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > max) max = v;
  }
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}

function makeNoise(ctx, kind) {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  normalize(data, 0.9);
  return buffer;
}

/** A dark, diffuse impulse response for the shared reverb. */
function makeImpulse(ctx, seconds = 3.4) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * 0.012);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let lowpassed = 0;
    for (let i = 0; i < length; i++) {
      if (i < preDelay) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelay) / (length - preDelay);
      lowpassed += 0.34 * (Math.random() * 2 - 1 - lowpassed);
      data[i] = lowpassed * Math.pow(1 - t, 2.2);
    }
  }
  return buffer;
}

/* ------------------------------------------------------------------ */
/* engine                                                              */
/* ------------------------------------------------------------------ */

const FADE_IN = 1.2;
const FADE_OUT = 0.35;

class Engine {
  constructor() {
    this.ctx = null;
    this.buffers = null;
    this.layers = new Map();
    this.masterVolume = 0.8;
    this.playing = false;
    this._generation = 0;
  }

  get analyser() {
    return this.analyserNode || null;
  }

  /** Create the context on the first user gesture (autoplay policies). */
  async ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch { /* ignore */ }
      }
      return this.ctx;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'playback' });
    this.ctx = ctx;

    this.buffers = {
      white: makeNoise(ctx, 'white'),
      pink: makeNoise(ctx, 'pink'),
      brown: makeNoise(ctx, 'brown'),
    };

    // shared reverb
    this.reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.85;
    this.reverbIn.connect(convolver).connect(this.reverbOut);

    // master chain: layers -> bus -> master -> limiter -> analyser -> out
    this.bus = ctx.createGain();
    this.reverbOut.connect(this.bus);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.28;

    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.meterBuffer = new Float32Array(this.analyserNode.fftSize);

    this.bus
      .connect(this.masterGain)
      .connect(limiter)
      .connect(this.analyserNode)
      .connect(ctx.destination);

    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    return ctx;
  }

  /* --------------------------------------------------------------- */

  play(fade = 1.2) {
    if (!this.ctx) return;
    this._generation++;
    this.playing = true;
    this._rampMaster(this.masterVolume, fade);
  }

  pause(fade = 0.9) {
    if (!this.ctx) return;
    this._generation++;
    this.playing = false;
    this._rampMaster(0, fade);
    const generation = this._generation;
    window.setTimeout(() => {
      if (generation === this._generation) this.destroyAll();
    }, fade * 1000 + 140);
  }

  setMaster(value) {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.ctx && this.playing) this._rampMaster(this.masterVolume, 0.12);
  }

  _rampMaster(value, seconds) {
    const param = this.masterGain.gain;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.03, seconds));
  }

  _volumeCurve(value) {
    const v = Math.max(0, Math.min(1, value));
    return Math.pow(v, 1.45);
  }

  /* --------------------------------------------------------------- */

  addLayer(def, volume = 0.6) {
    if (!this.ctx) return;
    if (this.layers.has(def.id)) {
      this.setVolume(def.id, volume);
      return;
    }

    const ctx = this.ctx;
    const input = ctx.createGain();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    input.connect(gain).connect(this.bus);

    const layer = {
      id: def.id,
      input,
      gain,
      nodes: new Set([input, gain]),
      sources: new Set(),
      intervals: new Set(),
      timeouts: new Set(),
      api: null,
      dead: false,
    };

    const env = {
      ctx,
      out: input,
      now: () => ctx.currentTime,
      buffer: (kind) => this.buffers[kind] || this.buffers.white,
      rand: (min = 0, max = 1) => min + Math.random() * (max - min),
      track: (node) => {
        layer.sources.add(node);
        if (typeof node.addEventListener === 'function') {
          node.addEventListener('ended', () => layer.sources.delete(node));
        }
        return node;
      },
      every: (ms, fn) => {
        const id = window.setInterval(fn, ms);
        layer.intervals.add(id);
        return id;
      },
      after: (ms, fn) => {
        const id = window.setTimeout(fn, ms);
        layer.timeouts.add(id);
        return id;
      },
      reverb: (amount = 0.3) => {
        const send = ctx.createGain();
        send.gain.value = amount;
        send.connect(this.reverbIn);
        layer.nodes.add(send);
        return send;
      },
    };

    try {
      layer.api = def.build(env);
    } catch (error) {
      console.error(`Could not start layer "${def.id}"`, error);
    }

    this.layers.set(def.id, layer);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(
      Math.max(0.0002, this._volumeCurve(volume)),
      now + FADE_IN,
    );
  }

  setVolume(id, value) {
    const layer = this.layers.get(id);
    if (!layer || !this.ctx) return;
    layer.gain.gain.setTargetAtTime(this._volumeCurve(value), this.ctx.currentTime, 0.08);
  }

  removeLayer(id) {
    const layer = this.layers.get(id);
    if (!layer || !this.ctx) return;
    this.layers.delete(id);

    const now = this.ctx.currentTime;
    const param = layer.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0.0001, now + FADE_OUT);

    window.setTimeout(() => this._teardown(layer), (FADE_OUT + 0.12) * 1000);
  }

  removeAll() {
    this.layers.forEach((layer) => this.removeLayer(layer.id));
  }

  destroyAll() {
    this._generation++;
    this.layers.forEach((layer) => this._teardown(layer));
    this.layers.clear();
  }

  _teardown(layer) {
    if (!layer || layer.dead) return;
    layer.dead = true;

    layer.intervals.forEach((id) => window.clearInterval(id));
    layer.timeouts.forEach((id) => window.clearTimeout(id));
    layer.intervals.clear();
    layer.timeouts.clear();

    try { layer.api && typeof layer.api.stop === 'function' && layer.api.stop(); } catch { /* ignore */ }

    layer.sources.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    layer.sources.clear();

    layer.nodes.forEach((node) => {
      try { node.disconnect(); } catch { /* ignore */ }
    });
    layer.nodes.clear();
  }
}

window.Hush.Engine = Engine;
