/**
 * S5 ENGINE_BUILD — generic runtime services: fixed-timestep loop, input,
 * synthesised audio, entity pooling, viewport management.
 *
 * Nothing here knows about Holafly. It knows about frames, taps and bytes.
 */
(function (window) {
  'use strict';

  var STEP_MS = 1000 / 60;
  var MAX_SUBSTEPS = 5;
  var DPR_CAP = 2; // Bounds fill cost on high-DPR mid-tier hardware.

  /**
   * Decouples simulation from render. Physics advances in fixed 1/60 steps, so
   * the 30s gameplay cap is 30s of wall clock on a 144Hz flagship and on a
   * 45 FPS budget phone alike, and jump arcs never change shape with frame rate.
   */
  function Loop(opts) {
    this.update = opts.update;
    this.render = opts.render;
    this.running = false;
    this.rafId = 0;
    this.accumulator = 0;
    this.lastTs = 0;
    this.elapsedMs = 0;
    this._frameTimes = [];
    this._tick = this._tickImpl.bind(this);
  }

  Loop.prototype._tickImpl = function (ts) {
    if (!this.running) return;
    this.rafId = window.requestAnimationFrame(this._tick);

    if (!this.lastTs) this.lastTs = ts;
    var delta = ts - this.lastTs;
    this.lastTs = ts;

    // A long stall (backgrounded tab, GC pause) must not be simulated away in
    // one burst; clamp it and drop the surplus.
    if (delta > 250) delta = STEP_MS;
    this._frameTimes.push(delta);
    if (this._frameTimes.length > 240) this._frameTimes.shift();

    this.accumulator += delta;
    var steps = 0;
    while (this.accumulator >= STEP_MS && steps < MAX_SUBSTEPS) {
      this.update(STEP_MS / 1000, this.elapsedMs);
      this.elapsedMs += STEP_MS;
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;

    this.render(this.accumulator / STEP_MS);
  };

  Loop.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    this.rafId = window.requestAnimationFrame(this._tick);
  };

  Loop.prototype.stop = function () {
    this.running = false;
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  };

  /** Rewinds the simulation clock. A replay has to start the 30s cap, the
   *  difficulty ramp and every `...UntilMs` deadline over from zero. */
  Loop.prototype.reset = function () {
    this.elapsedMs = 0;
    this.accumulator = 0;
    this.lastTs = 0;
  };

  Loop.prototype.meanFps = function () {
    if (this._frameTimes.length < 8) return 0;
    var sum = 0;
    for (var i = 0; i < this._frameTimes.length; i++) sum += this._frameTimes[i];
    return 1000 / (sum / this._frameTimes.length);
  };

  Loop.prototype.resetFpsSamples = function () { this._frameTimes.length = 0; };

  /** Pointer, touch and keyboard, normalised to a single tap signal. */
  function Input(target) {
    this.target = target;
    this.handlers = [];
    this.firstInputHandlers = [];
    this.hasInput = false;
    this._bound = [];
    this._attach();
  }

  Input.prototype._attach = function () {
    var self = this;
    var tap = function (ev) {
      // Let real controls (the CTA, the replay button) own their own taps.
      if (ev.target && ev.target.closest && ev.target.closest('[data-stop-tap]')) return;
      if (ev.type === 'keydown' && ev.code !== 'Space' && ev.code !== 'ArrowUp' && ev.code !== 'Enter') return;
      if (ev.cancelable) ev.preventDefault();
      if (!self.hasInput) {
        self.hasInput = true;
        self.firstInputHandlers.forEach(function (h) { h(); });
      }
      self.handlers.forEach(function (h) { h(); });
    };
    var add = function (el, type, fn, opts) {
      el.addEventListener(type, fn, opts);
      self._bound.push([el, type, fn, opts]);
    };
    add(this.target, 'touchstart', tap, { passive: false });
    add(this.target, 'mousedown', tap, false);
    add(window, 'keydown', tap, false);
  };

  Input.prototype.onTap = function (fn) { this.handlers.push(fn); };
  Input.prototype.onFirstInput = function (fn) { this.firstInputHandlers.push(fn); };

  Input.prototype.destroy = function () {
    this._bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2], b[3]); });
    this._bound.length = 0;
    this.handlers.length = 0;
    this.firstInputHandlers.length = 0;
  };

  /**
   * All audio is synthesised at runtime. That is worth 0 bytes of payload
   * against the 150KB audio budget, and it means there is no decode to block
   * first paint.
   */
  function Audio(muted) {
    this.muted = !!muted;
    this.ctx = null;
    this.master = null;
    this.suspended = false;
    // Sound is on by default, but nothing may make a noise before the player
    // has touched the creative: mobile webviews refuse to start an audio
    // context without a gesture, and ad networks reject creatives that try.
    // So the context is not even constructed until `unlock` says a real tap
    // has happened, and every blip before that is dropped.
    this.unlocked = false;
  }

  /** Called from the first user gesture and only from there. */
  Audio.prototype.unlock = function () {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.muted) return;
    if (this._ensure() && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype._ensure = function () {
    if (this.ctx) return true;
    if (!this.unlocked) return false;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (err) {
      this.ctx = null;
      return false;
    }
  };

  Audio.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.master) {
      this.master.gain.value = this.muted || this.suspended ? 0 : 0.5;
    }
    if (!this.muted) this._ensure();
    if (!this.muted && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  /** Hard mute for RULE-MRD-003: silence must be immediate, not faded. */
  Audio.prototype.suspend = function () {
    this.suspended = true;
    if (this.master) this.master.gain.value = 0;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  };

  Audio.prototype.resume = function () {
    this.suspended = false;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    if (!this.muted && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype.blip = function (freq, endFreq, durMs, type, gain) {
    if (this.muted || this.suspended || !this._ensure()) return;
    var t = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var env = this.ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + durMs / 1000);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain == null ? 0.3 : gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0008, t + durMs / 1000);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + durMs / 1000 + 0.02);
  };

  Audio.prototype.destroy = function () {
    if (this.ctx && this.ctx.state !== 'closed') {
      try { this.ctx.close(); } catch (err) { /* already gone */ }
    }
    this.ctx = null;
    this.master = null;
  };

  /**
   * Fixed-capacity entity pool. The steady-state frame allocates nothing, so
   * there is no GC sawtooth to drop frames into.
   */
  function Pool(factory, capacity) {
    this.items = [];
    for (var i = 0; i < capacity; i++) {
      var it = factory();
      it.active = false;
      this.items.push(it);
    }
  }

  Pool.prototype.spawn = function () {
    for (var i = 0; i < this.items.length; i++) {
      if (!this.items[i].active) {
        this.items[i].active = true;
        return this.items[i];
      }
    }
    return null;
  };

  Pool.prototype.each = function (fn) {
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].active) fn(this.items[i], i);
    }
  };

  Pool.prototype.clear = function () {
    for (var i = 0; i < this.items.length; i++) this.items[i].active = false;
  };

  /** Canvas sizing, DPR clamping, and orientation/resize notification. */
  function Viewport(canvas, onResize) {
    this.canvas = canvas;
    this.onResize = onResize;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this._bound = [];
    this._observer = null;
    this._raf = 0;
    this._apply = this.apply.bind(this);
    this._schedule = this._scheduleImpl.bind(this);
    this._attach();
    this.apply();
  }

  Viewport.prototype._scheduleImpl = function () {
    if (this._raf) return;
    var self = this;
    this._raf = window.requestAnimationFrame(function () {
      self._raf = 0;
      self.apply();
    });
  };

  Viewport.prototype._attach = function () {
    var self = this;
    var add = function (el, type, fn) {
      el.addEventListener(type, fn, false);
      self._bound.push([el, type, fn]);
    };
    add(window, 'resize', this._schedule);
    add(window, 'orientationchange', this._schedule);
    if (window.ResizeObserver) {
      this._observer = new window.ResizeObserver(this._schedule);
      this._observer.observe(this.canvas.parentElement || this.canvas);
    }
  };

  Viewport.prototype.apply = function () {
    var host = this.canvas.parentElement || document.documentElement;
    var w = Math.max(1, host.clientWidth);
    var h = Math.max(1, host.clientHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.onResize) this.onResize(w, h, dpr);
  };

  Viewport.prototype.destroy = function () {
    this._bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2], false); });
    this._bound.length = 0;
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._raf) window.cancelAnimationFrame(this._raf);
  };

  window.PlayableEngine = {
    Loop: Loop,
    Input: Input,
    Audio: Audio,
    Pool: Pool,
    Viewport: Viewport,
    STEP_MS: STEP_MS,
    DPR_CAP: DPR_CAP,
  };
})(window);
