/**
 * Hush — UI wiring
 */

(function () {
  const { Engine, SOUNDS, PRESETS } = window.Hush;
  const STORAGE_KEY = 'hush.mix.v1';
  const SOUND_BY_ID = new Map(SOUNDS.map((sound) => [sound.id, sound]));

  const engine = new Engine();

  const state = {
    volumes: Object.fromEntries(SOUNDS.map((sound) => [sound.id, sound.defaultVolume])),
    active: new Set(),
    master: 0.8,
    playing: false,
    timer: 0,
    timerEnd: 0,
    preset: null,
  };

  /* ---------------------------------------------------------------- */
  /* elements                                                         */
  /* ---------------------------------------------------------------- */

  const els = {
    grid: document.getElementById('grid'),
    presets: document.getElementById('presets'),
    scenes: document.getElementById('scenes'),
    play: document.getElementById('play'),
    label: document.getElementById('dock-label'),
    status: document.getElementById('dock-status'),
    master: document.getElementById('master'),
    timer: document.getElementById('timer'),
    timerButton: document.getElementById('timer-btn'),
    timerLabel: document.getElementById('timer-label'),
    timerMenu: document.getElementById('timer-menu'),
    timerRing: document.getElementById('timer-ring'),
    timerOptions: Array.from(document.querySelectorAll('.timer-option')),
    clear: document.getElementById('clear'),
    meter: Array.from(document.querySelectorAll('.meter i')),
  };

  const cards = new Map();
  const chips = new Map();
  const sceneEls = new Map();

  /* ---------------------------------------------------------------- */
  /* persistence                                                      */
  /* ---------------------------------------------------------------- */

  function save() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          volumes: state.volumes,
          active: Array.from(state.active),
          master: state.master,
        }),
      );
    } catch {
      /* storage may be unavailable; the mixer still works */
    }
  }

  function restore() {
    let data = null;
    try {
      data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return;

    if (data.volumes && typeof data.volumes === 'object') {
      for (const sound of SOUNDS) {
        const value = Number(data.volumes[sound.id]);
        if (Number.isFinite(value)) state.volumes[sound.id] = Math.min(1, Math.max(0, value));
      }
    }
    if (Array.isArray(data.active)) {
      state.active = new Set(data.active.filter((id) => SOUND_BY_ID.has(id)));
    }
    if (Number.isFinite(Number(data.master))) {
      state.master = Math.min(1, Math.max(0, Number(data.master)));
    }
  }

  /* ---------------------------------------------------------------- */
  /* cards                                                            */
  /* ---------------------------------------------------------------- */

  function createCard(sound) {
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--accent', sound.accent);
    card.dataset.id = sound.id;

    card.innerHTML = [
      '<button class="card-head" type="button" aria-pressed="false">',
      '<span class="icon-wrap">' + sound.icon + '</span>',
      '<span class="titles">',
      '<span class="card-title">' + sound.name + '</span>',
      '<span class="card-blurb">' + sound.blurb + '</span>',
      '</span>',
      '<span class="switch"></span>',
      '</button>',
      '<div class="card-vol">',
      '<input type="range" min="0" max="1" step="0.01" aria-label="' + sound.name + ' volume" />',
      '<output class="card-val">0%</output>',
      '</div>',
    ].join('');

    const head = card.querySelector('.card-head');
    const input = card.querySelector('input');
    const output = card.querySelector('.card-val');

    head.addEventListener('click', () => toggleLayer(sound.id));
    input.addEventListener('input', () => setVolume(sound.id, Number(input.value)));
    input.addEventListener('change', save);

    cards.set(sound.id, { el: card, head, input, output });
    return card;
  }

  function syncCards() {
    for (const [id, card] of cards) {
      const volume = state.volumes[id];
      const percent = Math.round(volume * 100);
      const on = state.active.has(id);

      card.el.classList.toggle('is-on', on);
      card.head.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.input.value = String(volume);
      card.input.style.setProperty('--fill', percent + '%');
      card.output.textContent = percent + '%';
    }
  }

  function setVolume(id, volume) {
    const clamped = Math.min(1, Math.max(0, volume));
    state.volumes[id] = clamped;
    engine.setVolume(id, clamped);

    const card = cards.get(id);
    if (card) {
      const percent = Math.round(clamped * 100);
      card.output.textContent = percent + '%';
      card.input.value = String(clamped);
      card.input.style.setProperty('--fill', percent + '%');
    }
    save();
  }

  /* ---------------------------------------------------------------- */
  /* background scenes                                                */
  /* ---------------------------------------------------------------- */

  const SCENE_EFFECTS = {
    'rainy-window': ['rain'],
    'forest-dawn': ['dawn'],
    'deep-thunder': ['flash'],
    'cozy-cabin': ['embers', 'snow'],
    'deep-sleep': ['stars', 'shooting'],
    focus: ['haze'],
  };

  function makeFx(kind) {
    const fx = document.createElement('span');
    fx.className = 'fx ' + kind;
    return fx;
  }

  /** Falling snow: each flake gets its own size, speed, sway and start point. */
  function createSnow(count) {
    const snow = makeFx('snow');
    const random = (min, max) => min + Math.random() * (max - min);

    for (let i = 0; i < count; i++) {
      const flake = document.createElement('i');
      flake.style.setProperty('--x', random(0, 100).toFixed(2) + '%');
      flake.style.setProperty('--size', random(1.6, 3.8).toFixed(1) + 'px');
      flake.style.setProperty('--o', random(0.35, 0.85).toFixed(2));
      flake.style.setProperty('--dur', random(11, 24).toFixed(1) + 's');
      flake.style.setProperty('--delay', (-random(0, 24)).toFixed(1) + 's');
      flake.style.setProperty('--drift', random(-5, 5).toFixed(0) + 'vw');
      snow.appendChild(flake);
    }

    return snow;
  }

  /** A field of stars that twinkle independently. */
  function createStars(count) {
    const stars = makeFx('stars');
    const random = (min, max) => min + Math.random() * (max - min);

    for (let i = 0; i < count; i++) {
      const star = document.createElement('i');
      star.style.setProperty('--x', random(0, 100).toFixed(2) + '%');
      star.style.setProperty('--y', random(0, 68).toFixed(2) + '%');
      star.style.setProperty('--size', random(1, 2.4).toFixed(1) + 'px');
      star.style.setProperty('--o', random(0.35, 0.95).toFixed(2));
      star.style.setProperty('--dur', random(3, 9).toFixed(1) + 's');
      star.style.setProperty('--delay', (-random(0, 9)).toFixed(1) + 's');
      stars.appendChild(star);
    }

    return stars;
  }

  /** A few meteors that streak across the sky every so often. */
  function createShootingStars(count) {
    const layer = makeFx('shooting');
    const random = (min, max) => min + Math.random() * (max - min);

    for (let i = 0; i < count; i++) {
      const meteor = document.createElement('i');
      meteor.style.setProperty('--top', random(2, 34).toFixed(1) + '%');
      meteor.style.setProperty('--left', random(2, 46).toFixed(1) + '%');
      meteor.style.setProperty('--len', random(90, 160).toFixed(0) + 'px');
      meteor.style.setProperty('--dur', random(12, 24).toFixed(1) + 's');
      meteor.style.setProperty('--delay', (-random(0, 24)).toFixed(1) + 's');
      meteor.style.setProperty('--travel', random(46, 62).toFixed(0) + 'vw');
      meteor.style.setProperty('--fall', random(18, 32).toFixed(0) + 'vh');
      layer.appendChild(meteor);
    }

    return layer;
  }

  function buildScenes() {
    const defs = [{ id: 'default', effects: [] }].concat(
      PRESETS.map((preset) => ({ id: preset.id, effects: SCENE_EFFECTS[preset.id] || [] })),
    );

    defs.forEach((def) => {
      const scene = document.createElement('div');
      scene.className = 'scene';
      scene.dataset.scene = def.id;
      if (def.id === 'default') scene.classList.add('is-active');

      def.effects.forEach((effect) => {
        if (effect === 'snow') scene.appendChild(createSnow(38));
        else if (effect === 'stars') scene.appendChild(createStars(54));
        else if (effect === 'shooting') scene.appendChild(createShootingStars(3));
        else scene.appendChild(makeFx(effect));
      });

      els.scenes.appendChild(scene);
      sceneEls.set(def.id, scene);
    });
  }

  /** Crossfade the backdrop to the scene that belongs to a mode. */
  function applyScene(presetId) {
    const active = presetId && sceneEls.has(presetId) ? presetId : 'default';
    sceneEls.forEach((scene, id) => scene.classList.toggle('is-active', id === active));
    document.body.dataset.scene = active;
  }

  /* ---------------------------------------------------------------- */
  /* presets                                                          */
  /* ---------------------------------------------------------------- */

  function createChip(preset) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = preset.name;
    chip.addEventListener('click', () => applyPreset(preset));
    chips.set(preset.id, chip);
    return chip;
  }

  function syncPresets() {
    for (const [id, chip] of chips) {
      chip.classList.toggle('is-current', state.preset === id && state.playing);
    }
  }

  function presetName() {
    if (!state.preset) return null;
    const preset = PRESETS.find((item) => item.id === state.preset);
    return preset ? preset.name : null;
  }

  async function applyPreset(preset) {
    await engine.ensure();
    engine.play(1.4);

    const previous = Array.from(state.active);
    previous.forEach((id) => engine.removeLayer(id));

    state.active = new Set(Object.keys(preset.mix));
    for (const [id, volume] of Object.entries(preset.mix)) {
      if (SOUND_BY_ID.has(id)) state.volumes[id] = volume;
    }
    state.active.forEach((id) => engine.addLayer(SOUND_BY_ID.get(id), state.volumes[id]));

    state.playing = true;
    state.preset = preset.id;
    applyScene(preset.id);

    syncCards();
    syncPresets();
    syncDock();
    save();
  }

  /* ---------------------------------------------------------------- */
  /* playback                                                         */
  /* ---------------------------------------------------------------- */

  async function toggleLayer(id) {
    if (state.active.has(id)) await turnOff(id);
    else await turnOn(id);
  }

  async function turnOn(id) {
    const sound = SOUND_BY_ID.get(id);
    if (!sound) return;

    await engine.ensure();
    engine.play(1.2);
    engine.addLayer(sound, state.volumes[id]);

    state.active.add(id);
    state.playing = true;
    state.preset = null;
    applyScene(null);

    syncCards();
    syncPresets();
    syncDock();
    save();
  }

  async function turnOff(id) {
    engine.removeLayer(id);
    state.active.delete(id);
    state.preset = null;
    applyScene(null);

    if (state.active.size === 0) pauseAll(0.7);

    syncCards();
    syncPresets();
    syncDock();
    save();
  }

  function pauseAll(fade) {
    state.playing = false;
    engine.pause(fade == null ? 0.9 : fade);
    syncPresets();
    syncDock();
  }

  async function togglePlay() {
    if (state.playing) {
      pauseAll();
      return;
    }

    await engine.ensure();

    if (state.active.size === 0) {
      const preset = PRESETS[0];
      state.active = new Set(Object.keys(preset.mix));
      Object.assign(state.volumes, preset.mix);
      state.preset = preset.id;
    }

    engine.play(1.4);
    state.active.forEach((id) => engine.addLayer(SOUND_BY_ID.get(id), state.volumes[id]));
    state.playing = true;

    syncCards();
    syncPresets();
    syncDock();
    save();
  }

  function clearMix() {
    Array.from(state.active).forEach((id) => engine.removeLayer(id));
    state.active.clear();
    state.playing = false;
    state.preset = null;
    applyScene(null);
    engine.pause(0.4);
    stopTimer();
    syncCards();
    syncPresets();
    syncDock();
    save();
  }

  /* ---------------------------------------------------------------- */
  /* sleep timer                                                      */
  /* ---------------------------------------------------------------- */

  let timerInterval = null;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 9.6;

  function startTimer(minutes) {
    state.timer = minutes;
    state.timerEnd = minutes > 0 ? Date.now() + minutes * 60000 : 0;

    if (timerInterval) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }
    if (state.timerEnd) {
      timerInterval = window.setInterval(() => {
        if (Date.now() >= state.timerEnd) {
          stopTimer();
          pauseAll(9);
        } else {
          syncTimer();
          syncDock();
        }
      }, 1000);
    }
    syncTimer();
    syncDock();
  }

  function stopTimer() {
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = null;
    state.timer = 0;
    state.timerEnd = 0;
    syncTimer();
  }

  /** Keep the pill, its progress ring and the menu selection in sync. */
  function syncTimer() {
    const running = state.timerEnd > 0;
    const remaining = Math.max(0, state.timerEnd - Date.now());

    els.timer.classList.toggle('is-running', running);
    els.timerLabel.textContent = running ? formatRemaining(remaining) : 'Timer';
    els.timerButton.setAttribute(
      'aria-label',
      running ? 'Sleep timer, ' + formatRemaining(remaining) + ' left' : 'Sleep timer: off',
    );

    const progress = running ? Math.min(1, remaining / (state.timer * 60000)) : 0;
    els.timerRing.style.strokeDasharray = RING_CIRCUMFERENCE.toFixed(2);
    els.timerRing.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - progress)).toFixed(2);

    els.timerOptions.forEach((option) => {
      const selected = running && Number(option.dataset.minutes) === state.timer;
      option.classList.toggle('is-current', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
  }

  /** Keep the pop-up inside the viewport, aligned to the pill's right edge. */
  function positionTimerMenu() {
    const menu = els.timerMenu;
    const rect = els.timer.getBoundingClientRect();
    const width = menu.offsetWidth;
    const margin = 12;

    let left = rect.width - width;
    const minLeft = margin - rect.left;
    const maxLeft = window.innerWidth - margin - width - rect.left;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    menu.style.right = 'auto';
    menu.style.left = Math.round(left) + 'px';
  }

  function setTimerMenu(open) {
    if (open) positionTimerMenu();
    els.timerMenu.classList.toggle('is-open', open);
    els.timerButton.classList.toggle('is-open', open);
    els.timerButton.setAttribute('aria-expanded', String(open));
  }

  function formatRemaining(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  /* ---------------------------------------------------------------- */
  /* dock                                                             */
  /* ---------------------------------------------------------------- */

  function syncDock() {
    const count = state.active.size;
    const preset = presetName();

    els.play.classList.toggle('is-playing', state.playing);
    els.play.setAttribute('aria-label', state.playing ? 'Pause all' : 'Play');
    els.play.setAttribute('title', state.playing ? 'Pause' : 'Play');

    if (state.playing) {
      els.label.textContent = preset || (count === 1 ? SOUND_BY_ID.get(Array.from(state.active)[0]).name : count + ' layers');
      els.status.textContent = state.timerEnd
        ? 'Fading out in ' + formatRemaining(state.timerEnd - Date.now())
        : 'Looping continuously';
    } else if (count > 0) {
      els.label.textContent = preset || 'Mix paused';
      els.status.textContent = count + (count === 1 ? ' layer ready' : ' layers ready') + ' · press play';
    } else {
      els.label.textContent = 'Nothing playing';
      els.status.textContent = 'Pick a sound to begin';
    }
  }

  /* ---------------------------------------------------------------- */
  /* meter                                                            */
  /* ---------------------------------------------------------------- */

  let meterLevel = 0;

  function tickMeter() {
    window.requestAnimationFrame(tickMeter);

    let target = 0;
    if (state.playing && engine.analyser && engine.meterBuffer) {
      engine.analyser.getFloatTimeDomainData(engine.meterBuffer);
      const data = engine.meterBuffer;
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      target = Math.min(1, Math.sqrt(sum / data.length) * 6);
    }

    meterLevel += (target - meterLevel) * (target > meterLevel ? 0.55 : 0.1);

    const bias = [0.5, 0.76, 1, 0.82, 0.56];
    els.meter.forEach((bar, index) => {
      const height = Math.max(0.08, Math.min(1, meterLevel * bias[index] * 1.7));
      bar.style.transform = 'scaleY(' + height.toFixed(3) + ')';
    });
  }

  /* ---------------------------------------------------------------- */
  /* init                                                             */
  /* ---------------------------------------------------------------- */

  SOUNDS.forEach((sound) => els.grid.appendChild(createCard(sound)));
  PRESETS.forEach((preset) => els.presets.appendChild(createChip(preset)));
  buildScenes();

  restore();
  applyScene(null);

  els.master.value = String(state.master);
  els.master.style.setProperty('--fill', Math.round(state.master * 100) + '%');

  els.play.addEventListener('click', togglePlay);
  els.clear.addEventListener('click', clearMix);

  els.master.addEventListener('input', () => {
    state.master = Number(els.master.value);
    engine.setMaster(state.master);
    els.master.style.setProperty('--fill', Math.round(state.master * 100) + '%');
    save();
  });

  els.timerButton.addEventListener('click', () => {
    setTimerMenu(!els.timerMenu.classList.contains('is-open'));
  });

  els.timerOptions.forEach((option) => {
    option.addEventListener('click', () => {
      startTimer(Number(option.dataset.minutes));
      setTimerMenu(false);
      els.timerButton.focus();
    });
  });

  document.addEventListener('click', (event) => {
    if (!els.timerMenu.classList.contains('is-open')) return;
    if (els.timer.contains(event.target)) return;
    setTimerMenu(false);
  });

  window.addEventListener('resize', () => {
    if (els.timerMenu.classList.contains('is-open')) positionTimerMenu();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.timerMenu.classList.contains('is-open')) {
      setTimerMenu(false);
      els.timerButton.focus();
      return;
    }
    if (event.code !== 'Space' || event.repeat) return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    event.preventDefault();
    togglePlay();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncDock();
  });

  syncCards();
  syncPresets();
  syncTimer();
  syncDock();
  window.requestAnimationFrame(tickMeter);

  // handy for debugging and automated checks
  window.__hush = { engine, state, applyPreset, togglePlay };
})();
