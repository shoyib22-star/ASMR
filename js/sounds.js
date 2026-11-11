/**
 * Hush sound definitions
 * ----------------------
 * Each entry knows how to build a live, seamlessly looping audio graph.
 * `build(env)` receives the shared engine context and returns an optional
 * `{ stop }` cleanup hook for its own schedulers.
 */

(function () {
  const Hush = (window.Hush = window.Hush || {});

  /* ---------------------------------------------------------------- */
  /* helpers                                                          */
  /* ---------------------------------------------------------------- */

  const svg = (paths) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';

  function noiseSource(env, kind) {
    const src = env.ctx.createBufferSource();
    src.buffer = env.buffer(kind);
    src.loop = true;
    src.start(env.now(), Math.random() * (src.buffer.duration - 0.5));
    env.track(src);
    return src;
  }

  /** Attach a slow oscillator to an AudioParam (filters, gains, pan). */
  function lfo(env, param, opts) {
    const { freq = 0.1, depth = 0, base = 0, type = 'sine' } = opts || {};
    const ctx = env.ctx;
    param.value = base;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const amount = ctx.createGain();
    amount.gain.value = depth;

    osc.connect(amount);
    amount.connect(param);
    osc.start(env.now());
    env.track(osc);
    return osc;
  }

  /** A very short filtered noise hit: droplets, crackles, thunder cracks. */
  function noiseBurst(env, o) {
    const ctx = env.ctx;
    const t0 = o.t0;
    const dur = o.dur;
    const src = ctx.createBufferSource();
    src.buffer = env.buffer(o.buffer || 'white');

    const filter = ctx.createBiquadFilter();
    filter.type = o.type || 'bandpass';
    filter.frequency.value = o.freq || 2000;
    filter.Q.value = o.q == null ? 1 : o.q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(o.gain || 0.05, t0 + Math.min(0.004, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const pan = ctx.createStereoPanner();
    pan.pan.value = o.pan == null ? 0 : o.pan;

    src.connect(filter).connect(gain).connect(pan).connect(env.out);
    src.start(t0, Math.random() * Math.max(0.1, src.buffer.duration - dur - 0.1));
    src.stop(t0 + dur + 0.05);
    env.track(src);
    return pan;
  }

  function softClipCurve() {
    const size = 1024;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    return curve;
  }
  let clipCurve = null;

  /* ---------------------------------------------------------------- */
  /* shared building blocks                                           */
  /* ---------------------------------------------------------------- */

  function addRainBed(env, opts) {
    const { ctx } = env;
    const level = (opts && opts.level) || 1;

    // main sheet of rain
    const pink = noiseSource(env, 'pink');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 480;
    hp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5600;
    const body = ctx.createGain();
    body.gain.value = 0.34 * level;
    pink.connect(hp).connect(lp).connect(body).connect(env.out);
    lfo(env, body.gain, {
      freq: 0.04 + Math.random() * 0.03,
      depth: 0.05 * level,
      base: 0.34 * level,
    });

    // fine hiss
    const white = noiseSource(env, 'white');
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3400;
    band.Q.value = 0.7;
    const hiss = ctx.createGain();
    hiss.gain.value = 0.07 * level;
    white.connect(band).connect(hiss).connect(env.out);

    // low body
    const brown = noiseSource(env, 'brown');
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const depth = ctx.createGain();
    depth.gain.value = 0.3 * level;
    brown.connect(low).connect(depth).connect(env.out);
  }

  function scheduleDrops(env, opts) {
    const density = (opts && opts.density) || 1;
    const level = (opts && opts.level) || 1;
    let stopped = false;
    let timer = null;

    const schedule = () => {
      if (stopped) return;
      timer = env.after((20 + Math.random() * 150) / density, () => {
        if (stopped) return;
        noiseBurst(env, {
          t0: env.now() + 0.01,
          dur: 0.02 + Math.random() * 0.05,
          freq: 1200 + Math.random() * 3200,
          q: 6 + Math.random() * 8,
          gain: (0.03 + Math.random() * 0.07) * level,
          pan: Math.random() * 2 - 1,
        });
        schedule();
      });
    };
    schedule();

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }

  function thunder(env, t0) {
    const ctx = env.ctx;
    const dur = 5 + Math.random() * 2.5;

    const src = ctx.createBufferSource();
    src.buffer = env.buffer('brown');

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 90 + Math.random() * 90;
    lp.Q.value = 0.8;

    if (!clipCurve) clipCurve = softClipCurve();
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve;
    shaper.oversample = '2x';

    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.18 + Math.random() * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.11, t0 + dur * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(lp).connect(shaper).connect(gain).connect(pan).connect(env.out);
    const send = env.reverb(0.35);
    pan.connect(send);

    src.start(t0, Math.random() * 3);
    src.stop(t0 + dur + 0.1);
    env.track(src);

    if (Math.random() < 0.5) {
      noiseBurst(env, {
        t0,
        dur: 0.45 + Math.random() * 0.5,
        type: 'highpass',
        freq: 700 + Math.random() * 500,
        q: 0.4,
        gain: 0.14,
        pan: pan.pan.value,
      });
    }
  }

  function birdCall(env, t0) {
    const ctx = env.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(env.out);
    pan.connect(env.reverb(0.55));

    const roll = Math.random();
    const notes = roll < 0.38 ? 1 : roll < 0.78 ? 2 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 3);
    const base = 1850 + Math.random() * 1500;

    let t = t0;
    for (let i = 0; i < notes; i++) {
      const dur = 0.05 + Math.random() * 0.1;
      const f0 = base * (0.85 + Math.random() * 0.3);
      const rising = Math.random() < 0.65;
      const f1 = f0 * (rising ? 1.3 + Math.random() * 0.5 : 0.68 + Math.random() * 0.16);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.055 + Math.random() * 0.04, t + dur * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain).connect(pan);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      env.track(osc);

      t += dur + 0.03 + Math.random() * 0.08;
    }
  }

  function bell(env, t0, freq, opts) {
    const { gain = 0.04, decay = 4, pan = 0 } = opts || {};
    const ctx = env.ctx;

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(env.out);
    panner.connect(env.reverb(0.7));

    const partials = [
      [1, 1, 1],
      [2.01, 0.32, 0.55],
      [3.03, 0.14, 0.32],
    ];

    partials.forEach(([mult, amp, durMult]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;

      const gainNode = ctx.createGain();
      const end = t0 + decay * durMult;
      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.linearRampToValueAtTime(gain * amp, t0 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gainNode).connect(panner);
      osc.start(t0);
      osc.stop(end + 0.05);
      env.track(osc);
    });
  }

  function padNote(env, t0, freq, opts) {
    const {
      attack = 7,
      hold = 16,
      release = 9,
      gain = 0.042,
    } = opts || {};
    const ctx = env.ctx;
    const end = t0 + attack + hold + release;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq;
    osc2.detune.value = 7;

    const tone = ctx.createGain();
    tone.gain.setValueAtTime(0.0001, t0);
    tone.gain.linearRampToValueAtTime(gain, t0 + attack);
    tone.gain.setValueAtTime(gain, t0 + attack + hold);
    tone.gain.exponentialRampToValueAtTime(0.0001, end);

    const blend = ctx.createGain();
    blend.gain.value = 0.32;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.4;

    osc.connect(tone);
    osc2.connect(blend).connect(tone);
    tone.connect(lp).connect(env.out);
    lp.connect(env.reverb(0.5));

    osc.start(t0);
    osc2.start(t0);
    osc.stop(end + 0.05);
    osc2.stop(end + 0.05);
    env.track(osc);
    env.track(osc2);
  }

  /* ---------------------------------------------------------------- */
  /* layers                                                           */
  /* ---------------------------------------------------------------- */

  const SOUNDS = [
    {
      id: 'rain',
      name: 'Rain',
      blurb: 'Steady rainfall on glass',
      accent: '#6fb3e0',
      defaultVolume: 0.6,
      icon: svg(
        '<path d="M7.5 14.5a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18.4 8.5a3.5 3.5 0 0 1-.6 6"/>' +
        '<path d="M8.5 18l-1 2M12.5 18l-1 2M16.5 18l-1 2"/>',
      ),
      build(env) {
        addRainBed(env, { level: 1 });
        return { stop: scheduleDrops(env, { density: 1, level: 1 }) };
      },
    },
    {
      id: 'thunderstorm',
      name: 'Thunderstorm',
      blurb: 'Distant rumble and downpour',
      accent: '#b6a3f5',
      defaultVolume: 0.55,
      icon: svg(
        '<path d="M7.5 13.5a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18.4 7.5a3.5 3.5 0 0 1-.6 6"/>' +
        '<path d="M12.4 12l-2.6 4.4h3.2L11.1 21"/>',
      ),
      build(env) {
        addRainBed(env, { level: 0.9 });

        let stopped = false;
        let timer = null;
        const schedule = () => {
          if (stopped) return;
          timer = env.after(7000 + Math.random() * 17000, () => {
            if (stopped) return;
            const t0 = env.now() + 0.15;
            thunder(env, t0);
            if (Math.random() < 0.28) thunder(env, t0 + 1.6 + Math.random() * 2.6);
            schedule();
          });
        };
        schedule();

        return {
          stop() {
            stopped = true;
            if (timer) window.clearTimeout(timer);
          },
        };
      },
    },
    {
      id: 'ocean',
      name: 'Ocean',
      blurb: 'Waves arriving on the shore',
      accent: '#6fd0d8',
      defaultVolume: 0.5,
      icon: svg(
        '<path d="M3 8.5c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 4.3-2 5 0"/>' +
        '<path d="M3 14c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 4.3-2 5 0"/>' +
        '<path d="M3 19.5c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 4.3-2 5 0"/>',
      ),
      build(env) {
        const { ctx } = env;
        const pan = ctx.createStereoPanner();
        pan.connect(env.out);
        pan.connect(env.reverb(0.25));

        const brown = noiseSource(env, 'brown');
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 950;
        lp.Q.value = 0.4;
        const swell = ctx.createGain();
        brown.connect(lp).connect(swell).connect(pan);
        lfo(env, swell.gain, { freq: 0.072, depth: 0.2, base: 0.22 });
        lfo(env, lp.frequency, { freq: 0.072, depth: 500, base: 950 });
        lfo(env, pan.pan, { freq: 0.026, depth: 0.55, base: 0 });

        const white = noiseSource(env, 'white');
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1500;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 3200;
        band.Q.value = 0.5;
        const foam = ctx.createGain();
        white.connect(hp).connect(band).connect(foam).connect(pan);
        lfo(env, foam.gain, { freq: 0.074, depth: 0.045, base: 0.05 });

        return {};
      },
    },
    {
      id: 'wind',
      name: 'Wind',
      blurb: 'Slow gusts through the trees',
      accent: '#9ad0c2',
      defaultVolume: 0.5,
      icon: svg(
        '<path d="M3 8.5h9.5A2.6 2.6 0 1 0 9.9 5.9"/>' +
        '<path d="M3 13h12.5a2.6 2.6 0 1 1-2.6 2.6"/>' +
        '<path d="M3 17.5h6"/>',
      ),
      build(env) {
        const { ctx } = env;

        const pan = ctx.createStereoPanner();
        pan.connect(env.out);
        pan.connect(env.reverb(0.22));

        const brown = noiseSource(env, 'brown');
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 430;
        lp.Q.value = 0.6;
        const body = ctx.createGain();
        brown.connect(lp).connect(body).connect(pan);
        lfo(env, lp.frequency, { freq: 0.055, depth: 260, base: 430 });
        lfo(env, body.gain, { freq: 0.042, depth: 0.26, base: 0.42 });
        lfo(env, pan.pan, { freq: 0.021, depth: 0.65, base: 0 });

        const pan2 = ctx.createStereoPanner();
        pan2.connect(env.out);
        pan2.connect(env.reverb(0.22));

        const pink = noiseSource(env, 'pink');
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 820;
        band.Q.value = 1.1;
        const whistle = ctx.createGain();
        pink.connect(band).connect(whistle).connect(pan2);
        lfo(env, band.frequency, { freq: 0.083, depth: 380, base: 900 });
        lfo(env, whistle.gain, { freq: 0.067, depth: 0.12, base: 0.16 });
        lfo(env, pan2.pan, { freq: 0.017, depth: 0.8, base: 0 });

        return {};
      },
    },
    {
      id: 'birds',
      name: 'Birds',
      blurb: 'Morning chatter at a distance',
      accent: '#f0c27b',
      defaultVolume: 0.45,
      icon: svg(
        '<path d="M3.5 9c2.2 0 3.8-1.2 4.8-3.4.9 2.2 2.4 3.4 4.5 3.4"/>' +
        '<path d="M11.5 15.5c2.2 0 3.8-1.2 4.8-3.4.9 2.2 2.4 3.4 4.5 3.4"/>',
      ),
      build(env) {
        const ctx = env.ctx;

        // quiet forest bed so the calls sit in a space
        const pink = noiseSource(env, 'pink');
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 620;
        band.Q.value = 0.6;
        const bed = ctx.createGain();
        bed.gain.value = 0.09;
        pink.connect(band).connect(bed).connect(env.out);
        lfo(env, bed.gain, { freq: 0.05, depth: 0.03, base: 0.09 });

        let stopped = false;
        let timer = null;
        const schedule = () => {
          if (stopped) return;
          timer = env.after(1200 + Math.random() * 4200, () => {
            if (stopped) return;
            birdCall(env, env.now() + 0.05);
            if (Math.random() < 0.35) {
              env.after(320 + Math.random() * 700, () => {
                if (!stopped) birdCall(env, env.now() + 0.05);
              });
            }
            schedule();
          });
        };
        schedule();

        return {
          stop() {
            stopped = true;
            if (timer) window.clearTimeout(timer);
          },
        };
      },
    },
    {
      id: 'snowfall',
      name: 'Snowfall',
      blurb: 'Soft hush and crystal bells',
      accent: '#cfe4ff',
      defaultVolume: 0.42,
      icon: svg(
        '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>' +
        '<path d="M12 5.6l1.9-1.5M12 5.6L10.1 4.1M12 18.4l1.9 1.5M12 18.4l-1.9 1.5"/>',
      ),
      build(env) {
        const ctx = env.ctx;

        const air = noiseSource(env, 'white');
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 4200;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 11000;
        const shimmer = ctx.createGain();
        air.connect(hp).connect(lp).connect(shimmer).connect(env.out);
        lfo(env, shimmer.gain, { freq: 0.06, depth: 0.02, base: 0.05 });

        const pan = ctx.createStereoPanner();
        pan.connect(env.out);
        pan.connect(env.reverb(0.3));
        const pink = noiseSource(env, 'pink');
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 900;
        band.Q.value = 0.7;
        const mid = ctx.createGain();
        pink.connect(band).connect(mid).connect(pan);
        lfo(env, mid.gain, { freq: 0.04, depth: 0.03, base: 0.08 });

        const brown = noiseSource(env, 'brown');
        const sub = ctx.createBiquadFilter();
        sub.type = 'lowpass';
        sub.frequency.value = 180;
        const subGain = ctx.createGain();
        subGain.gain.value = 0.11;
        brown.connect(sub).connect(subGain).connect(env.out);

        const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
        let stopped = false;
        let timer = null;
        const schedule = () => {
          if (stopped) return;
          timer = env.after(2600 + Math.random() * 6500, () => {
            if (stopped) return;
            const freq = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.4 ? 0.5 : 1);
            bell(env, env.now() + 0.05, freq, {
              gain: 0.026 + Math.random() * 0.022,
              decay: 3.5 + Math.random() * 3,
              pan: Math.random() * 1.6 - 0.8,
            });
            schedule();
          });
        };
        schedule();

        return {
          stop() {
            stopped = true;
            if (timer) window.clearTimeout(timer);
          },
        };
      },
    },
    {
      id: 'fireplace',
      name: 'Fireplace',
      blurb: 'Warm crackle and low roar',
      accent: '#ff9a6b',
      defaultVolume: 0.45,
      icon: svg(
        '<path d="M12 21c3.6 0 6-2.5 6-5.9 0-4.3-3.8-6-3.8-9.6-1.6 1-2.4 2.6-2.6 4.2-.6-.7-1-1.7-1.2-2.8C8.3 8.6 6 11.2 6 15.1 6 18.5 8.4 21 12 21z"/>' +
        '<path d="M12 21c1.5 0 2.5-1.1 2.5-2.6 0-1.8-1.6-2.6-1.6-4.2-1 .9-1.6 2.1-1.6 3.4 0 .8-.4 1.3-1 1.6"/>',
      ),
      build(env) {
        const ctx = env.ctx;

        const brown = noiseSource(env, 'brown');
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 240;
        const roar = ctx.createGain();
        roar.gain.value = 0.34;
        brown.connect(lp).connect(roar).connect(env.out);
        lfo(env, roar.gain, { freq: 0.13, depth: 0.09, base: 0.34 });

        const pink = noiseSource(env, 'pink');
        const band = ctx.createBiquadFilter();
        band.type = 'lowpass';
        band.frequency.value = 1100;
        const hiss = ctx.createGain();
        hiss.gain.value = 0.1;
        pink.connect(band).connect(hiss).connect(env.out);

        let stopped = false;
        let timer = null;
        const schedule = () => {
          if (stopped) return;
          timer = env.after(70 + Math.random() * 420, () => {
            if (stopped) return;
            const big = Math.random() < 0.1;
            noiseBurst(env, {
              t0: env.now() + 0.01,
              dur: big ? 0.07 + Math.random() * 0.1 : 0.01 + Math.random() * 0.03,
              type: big ? 'lowpass' : 'highpass',
              freq: big ? 500 : 1800 + Math.random() * 3500,
              q: 0.9,
              gain: big ? 0.12 : 0.028 + Math.random() * 0.055,
              pan: Math.random() * 1.4 - 0.7,
            });
            schedule();
          });
        };
        schedule();

        return {
          stop() {
            stopped = true;
            if (timer) window.clearTimeout(timer);
          },
        };
      },
    },
    {
      id: 'alpha',
      name: 'Alpha Waves',
      blurb: '10 Hz binaural drift · headphones',
      accent: '#a9b6ff',
      defaultVolume: 0.36,
      icon: svg(
        '<path d="M2.5 12h3l2.2-5.5 3 11 2.9-8.2 2 2.7h6"/>',
      ),
      build(env) {
        const ctx = env.ctx;

        const tone = (freq, pan, level) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const gain = ctx.createGain();
          gain.gain.value = level;
          const panner = ctx.createStereoPanner();
          panner.pan.value = pan;
          osc.connect(gain).connect(panner).connect(env.out);
          osc.start(env.now());
          env.track(osc);
        };

        // 200 Hz left / 210 Hz right -> a 10 Hz alpha beat in headphones
        tone(200, -1, 0.04);
        tone(210, 1, 0.04);

        // isochronic pulse so the rhythm survives on speakers
        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = 220;
        const amp = ctx.createGain();
        amp.gain.value = 0.5;
        const pulse = ctx.createOscillator();
        pulse.type = 'sine';
        pulse.frequency.value = 10;
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        const pulseLevel = ctx.createGain();
        pulseLevel.gain.value = 0.028;

        carrier.connect(amp).connect(pulseLevel).connect(env.out);
        pulse.connect(depth).connect(amp.gain);
        carrier.start(env.now());
        pulse.start(env.now());
        env.track(carrier);
        env.track(pulse);

        // warm drone bed
        [110, 164.81, 220].forEach((freq, index) => {
          const osc = ctx.createOscillator();
          osc.type = index === 0 ? 'sine' : 'triangle';
          osc.frequency.value = freq;

          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 700;

          const gain = ctx.createGain();
          osc.connect(gain).connect(lp).connect(env.out);
          lp.connect(env.reverb(0.5));

          lfo(env, gain.gain, {
            freq: 0.028 + index * 0.013,
            depth: 0.016,
            base: 0.045 - index * 0.008,
          });

          osc.start(env.now());
          env.track(osc);
        });

        return {};
      },
    },
    {
      id: 'pad',
      name: 'Dream Pad',
      blurb: 'Slow chords, endless loop',
      accent: '#d9a7ff',
      defaultVolume: 0.32,
      icon: svg(
        '<path d="M9 17.5V6.2l9.5-1.8v11.1"/>' +
        '<circle cx="6.3" cy="18" r="2.8"/><circle cx="15.8" cy="15.5" r="2.8"/>',
      ),
      build(env) {
        // A four-chord cycle, 30 s each: the harmonic loop is two minutes
        // long, and it repeats forever without a seam.
        const CHORDS = [
          [73.42, 110.0, 146.83, 185.0],
          [61.74, 92.5, 123.47, 146.83],
          [49.0, 73.42, 98.0, 123.47],
          [55.0, 82.41, 110.0, 138.59],
        ];
        const CHORD_SECONDS = 30;
        const sparkles = [587.33, 659.25, 880, 987.77, 1174.66];

        let next = env.now() + 0.5;
        let index = 0;

        const schedule = () => {
          const now = env.now();

          // If the tab was throttled, skip the chords we missed instead of
          // stacking them all on top of each other.
          if (next < now - 0.5) {
            const missed = Math.ceil((now - next) / CHORD_SECONDS);
            next += missed * CHORD_SECONDS;
            index += missed;
          }

          const horizon = now + 2.5;
          let guard = 0;
          while (next < horizon && guard++ < 8) {
            const chord = CHORDS[index % CHORDS.length];
            chord.forEach((freq, i) => {
              padNote(env, next + i * 0.7, freq, {
                gain: i === 0 ? 0.05 : 0.036,
              });
            });

            if (Math.random() < 0.7) {
              bell(env, next + 12 + Math.random() * 12, sparkles[Math.floor(Math.random() * sparkles.length)], {
                gain: 0.018,
                decay: 5,
                pan: Math.random() * 1.4 - 0.7,
              });
            }

            index++;
            next += CHORD_SECONDS;
          }
        };

        schedule();
        env.every(500, schedule);

        return {};
      },
    },
  ];

  const PRESETS = [
    {
      id: 'rainy-window',
      name: 'Rainy Window',
      mix: { rain: 0.62, wind: 0.26, thunderstorm: 0.16, pad: 0.22 },
    },
    {
      id: 'forest-dawn',
      name: 'Forest Dawn',
      mix: { birds: 0.55, wind: 0.3, ocean: 0.1, pad: 0.2 },
    },
    {
      id: 'deep-thunder',
      name: 'Deep Thunder',
      mix: { thunderstorm: 0.68, wind: 0.4, fireplace: 0.12 },
    },
    {
      id: 'cozy-cabin',
      name: 'Cozy Cabin',
      mix: { fireplace: 0.58, wind: 0.36, snowfall: 0.26, pad: 0.14 },
    },
    {
      id: 'deep-sleep',
      name: 'Deep Sleep',
      mix: { alpha: 0.34, pad: 0.32, rain: 0.24, snowfall: 0.2 },
    },
    {
      id: 'focus',
      name: 'Focus',
      mix: { alpha: 0.45, rain: 0.2, pad: 0.16 },
    },
  ];

  Hush.SOUNDS = SOUNDS;
  Hush.PRESETS = PRESETS;
})();
