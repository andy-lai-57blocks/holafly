/**
 * S5/S6 — wiring and the funnel state machine.
 *
 * Implements PlayableFunnelState from the hook-and-conversion skill:
 * INIT -> HOOK_ACTIVE -> IDLE_HINT -> INTERACTIVE_GAMEPLAY -> ENDCARD -> CLICKTHROUGH.
 *
 * Exposes window.__playable purely so the S8 gate can measure the creative
 * from outside instead of guessing at it. It reads state; it does not drive it.
 */
(function (window) {
  'use strict';

  var cfg = window.PlayableConfig;
  var E = window.PlayableEngine;
  var UIlib = window.PlayableUI;

  var funnel = {
    currentState: 'INIT',
    idleTimeoutMs: cfg.gameplay.idleTimeoutMs,
    maxGameplayDurationMs: cfg.gameplay.maxGameplayDurationMs,
    ctaDebounceMs: cfg.gameplay.ctaDebounceMs,
    history: ['INIT'],
    transition: function (next) {
      if (this.currentState === next) return;
      this.currentState = next;
      this.history.push(next);
    },
  };

  var metrics = {
    // Two timebases on purpose. `launchedAt` is when the container handed us
    // the document, which is what RULE-CVR-003's 1.5s idle deadline is
    // measured against. `startedAt` is when the runner actually began moving,
    // which is what the 30s gameplay cap is measured against.
    launchedAt: 0,
    startedAt: 0,
    firstGateAtMs: null,
    idleHintShownAtMs: null,
    firstInputAtMs: null,
    endcardAtMs: null,
    endReason: null,
    ctaOpens: 0,
    ctaTaps: 0,
    lastClickUrl: null,
    pauses: 0,
    resumes: 0,
    replays: 0,
    loopRunning: false,
    destroyed: false,
  };

  var dict;
  var ui;
  var game;
  var loop;
  var input;
  var audio;
  var viewport;
  var sprites = {};
  var idleArmTimer = 0;
  var hookTimer = 0;
  var staticTimer = 0;

  // The only zone-effect hazard, read once so the crackle cadence stays a
  // config decision rather than a literal in here (RULE-CFG-001).
  var zoneSpec = (cfg.gameplay.hazards || []).filter(function (h) {
    return h.effect === 'zone';
  })[0] || {};

  function now() { return window.performance ? window.performance.now() : Date.now(); }

  metrics.launchedAt = now();

  /**
   * Decodes the inlined brand rasters before the first frame so the opening
   * seconds never show a half-dressed scene. Bounded, because a single bad
   * data URI must not be able to hold the creative hostage.
   */
  function loadSprites(assets) {
    var names = Object.keys(assets);
    return new Promise(function (resolve) {
      var pending = names.length;
      if (!pending) { resolve(); return; }
      var settle = function () { if (--pending <= 0) resolve(); };
      var guard = window.setTimeout(function () { pending = 0; resolve(); }, 1200);

      names.forEach(function (name) {
        var img = new window.Image();
        img.decoding = 'sync';
        img.onload = function () { sprites[name] = img; settle(); };
        img.onerror = settle;
        img.src = assets[name];
      });

      Promise.resolve().then(function () {
        if (pending <= 0) window.clearTimeout(guard);
      });
    });
  }

  // Counts down from launch, not from game start, so the MRAID handshake
  // cannot eat into the idle-hint budget.
  function armIdleHint() {
    window.clearTimeout(idleArmTimer);
    var remaining = Math.max(0, funnel.idleTimeoutMs - (now() - metrics.launchedAt));
    idleArmTimer = window.setTimeout(function () {
      if (funnel.currentState !== 'HOOK_ACTIVE') return;
      funnel.transition('IDLE_HINT');
      metrics.idleHintShownAtMs = now() - metrics.launchedAt;
      ui.el.idleHint.classList.add('show');
    }, remaining);
  }

  function onFirstInput() {
    window.clearTimeout(idleArmTimer);
    ui.cancelIdleHint();
    // The only moment an audio context may legally be opened. There is no
    // sound control in the creative, so if this gesture is not used the run
    // stays silent for good.
    audio.unlock();
    if (metrics.firstInputAtMs == null) metrics.firstInputAtMs = now() - metrics.startedAt;
    if (funnel.currentState === 'HOOK_ACTIVE' || funnel.currentState === 'IDLE_HINT') {
      funnel.transition('INTERACTIVE_GAMEPLAY');
    }
  }

  /**
   * Only consulted when the container declines to route the click itself.
   * Sending an iPhone to a Play Store listing burns the tap, so the store has
   * to follow the device. iPadOS reports itself as a Mac, hence the touch
   * probe rather than a straight UA match.
   */
  function resolveClickUrl() {
    var byPlatform = cfg.appDetails.clickUrlByPlatform || {};
    var nav = window.navigator || {};
    var ua = nav.userAgent || '';
    var isIos = /iPhone|iPad|iPod/i.test(ua) ||
      (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    if (isIos && byPlatform.ios) return byPlatform.ios;
    if (/Android/i.test(ua) && byPlatform.android) return byPlatform.android;
    return cfg.appDetails.clickUrl;
  }

  function openClickthrough(source) {
    metrics.ctaTaps++;
    var url = resolveClickUrl();
    funnel.transition('CLICKTHROUGH');
    metrics.ctaOpens++;
    metrics.lastClickUrl = url;
    metrics.lastCtaSource = source || null;
    window.MRAIDBridge.openClickthrough(url);
  }

  function showEndcard(stats) {
    if (funnel.currentState === 'ENDCARD' || funnel.currentState === 'CLICKTHROUGH') return;
    funnel.transition('ENDCARD');
    metrics.endcardAtMs = now() - metrics.startedAt;
    metrics.endReason = stats.reason;
    window.clearTimeout(idleArmTimer);
    ui.cancelIdleHint();
    // The run can end mid-zone, and `onZone` will never fire again to clear
    // it, so the interference stops here rather than bleeding into the endcard.
    setSignalStatic(false);
    ui.setSignalLoss(false);
    ui.showEndcard(stats);
    // The scene is fully occluded by the endcard, so there is nothing left to
    // render; stopping the loop is both correct and kind to the battery.
    loop.stop();
    metrics.loopRunning = false;
    audio.blip(560, 880, 260, 'triangle', 0.22);
  }

  /**
   * A second run for the player who is not ready to install yet. Everything
   * that carries a deadline has to rewind together: the simulation clock backs
   * the 30s cap and every `...UntilMs` in the game state, so replaying without
   * resetting it would end the new run on the first frame.
   */
  function replay() {
    if (funnel.currentState !== 'ENDCARD') return;
    window.clearTimeout(hookTimer);
    setSignalStatic(false);
    ui.setSignalLoss(false);
    ui.hideEndcard();

    game.reset();
    relayout();
    ui.setMeter(game.state.meter);
    ui.setDestinations(0);

    loop.reset();
    loop.start();
    metrics.loopRunning = true;
    metrics.replays++;
    metrics.startedAt = now();
    metrics.endcardAtMs = null;
    metrics.endReason = null;
    // Straight back into gameplay: this player has already demonstrated intent
    // by tapping replay, so the idle affordance would only be in the way.
    funnel.transition('INTERACTIVE_GAMEPLAY');
    hookTimer = window.setTimeout(function () { ui.hideHook(); }, 2900);
    audio.blip(420, 760, 180, 'triangle', 0.2);
  }

  /**
   * A coverage hole lasts about a second, so it needs a sustained sound, not
   * the one-shot every other hazard gets. Randomised low square bursts on a
   * timer are the cheapest convincing static out of the oscillator the rest
   * of the creative already uses. Blips no-op while muted or suspended, so
   * the timer is safe to leave running across a pause.
   */
  function setSignalStatic(on) {
    window.clearInterval(staticTimer);
    staticTimer = 0;
    if (!on) return;
    var crackle = function () {
      audio.blip(140 + Math.random() * 110, 90, 70, 'square', 0.085);
    };
    crackle();
    staticTimer = window.setInterval(crackle, zoneSpec.staticIntervalMs || 90);
  }

  function gameEvents() {
    return {
      onJump: function (isAirJump) {
        audio.blip(isAirJump ? 660 : 480, isAirJump ? 940 : 720, 110, 'triangle', 0.2);
      },
      onMeter: function (pct) { ui.setMeter(pct); },
      onGate: function (key) {
        if (metrics.firstGateAtMs == null) metrics.firstGateAtMs = now() - metrics.startedAt;
        ui.hideHook();
        ui.setDestinations(game.state.destinationsCrossed);
        ui.banner(dict.t('gateBanner', { place: dict.place(key) }), 'good');
        audio.blip(520, 1040, 220, 'sine', 0.22);
      },
      onOrb: function () {
        ui.banner(dict.t('orbBanner'), 'good');
        audio.blip(880, 1320, 130, 'sine', 0.2);
      },
      onCoin: function () { audio.blip(1040, 1560, 110, 'sine', 0.16); },
      onBoost: function () {
        ui.banner(dict.t('boostBanner'), 'good');
        audio.blip(320, 1180, 300, 'sawtooth', 0.16);
      },
      onHazard: function (kind) {
        ui.banner(dict.hazard(kind), 'bad');
        audio.blip(220, 110, 240, 'square', 0.18);
      },
      onZone: function (active) {
        ui.setSignalLoss(active);
        setSignalStatic(active);
      },
      onRescue: function () {
        ui.banner(dict.t('rescueBanner'), 'neutral');
        audio.blip(400, 900, 380, 'triangle', 0.24);
      },
      onEnd: function (stats) { showEndcard(stats); },
    };
  }

  // Takes its dimensions as arguments because Viewport fires its first resize
  // from inside its own constructor, before `viewport` has been assigned.
  function relayout(w, h, dpr) {
    if (!game) return;
    if (w == null && viewport) { w = viewport.width; h = viewport.height; dpr = viewport.dpr; }
    if (w == null) return;
    game.layout(w, h, dpr);
    ui.refit();
  }

  function destroy() {
    if (metrics.destroyed) return;
    metrics.destroyed = true;
    window.clearTimeout(idleArmTimer);
    window.clearTimeout(hookTimer);
    window.clearInterval(staticTimer);
    if (loop) { loop.stop(); metrics.loopRunning = false; }
    if (input) input.destroy();
    if (viewport) viewport.destroy();
    if (ui) ui.destroy();
    if (audio) audio.destroy();
    if (game) game.destroy();
    if (window.MRAIDBridge) window.MRAIDBridge.destroy();
  }

  function start() {
    var locale = UIlib.resolveLocale(cfg, window.location.search);
    dict = new UIlib.Dictionary(cfg, locale);

    var root = document.getElementById('playable-root');
    ui = new UIlib.UI({
      config: cfg,
      dict: dict,
      root: root,
      onCta: openClickthrough,
      onReplay: replay,
    });

    audio = new E.Audio(cfg.audio.defaultMuted);

    var canvas = document.getElementById('game');
    game = new window.PlayableGame({
      config: cfg,
      canvas: canvas,
      sprites: sprites,
      glyphs: { currency: dict.t('currencyGlyph') },
      events: gameEvents(),
    });

    viewport = new E.Viewport(canvas, relayout);
    relayout();

    ui.setMeter(game.state.meter);
    ui.setDestinations(0);

    loop = new E.Loop({
      update: function (dt, elapsedMs) { game.update(dt, elapsedMs); },
      render: function () { game.render(); },
    });

    input = new E.Input(document.getElementById('stage'));
    input.onFirstInput(onFirstInput);
    input.onTap(function () { game.jump(); });

    window.MRAIDBridge.init({
      clickUrl: resolveClickUrl(),
      onGameStart: function (info) {
        metrics.startedAt = now();
        // A deferred start means the creative sat cached off-screen and the
        // player is only now seeing the first frame. The idle-hint deadline is
        // about how long a human stares at a still picture, so it has to count
        // from that moment; leaving it on the load timebase would fire the
        // hint instantly and skip the headline it is supposed to follow.
        if (info && info.deferred) metrics.launchedAt = metrics.startedAt;
        // The runner is already moving, so the authentic product hook plays
        // without waiting for input (RULE-CVR-001).
        funnel.transition('HOOK_ACTIVE');
        loop.start();
        metrics.loopRunning = true;
        armIdleHint();
        hookTimer = window.setTimeout(function () { ui.hideHook(); }, 2900);
      },
      onPause: function () {
        metrics.pauses++;
        audio.suspend();
        if (loop) { loop.stop(); metrics.loopRunning = false; }
      },
      onResume: function () {
        metrics.resumes++;
        audio.resume();
        if (loop && funnel.currentState !== 'ENDCARD' && funnel.currentState !== 'CLICKTHROUGH') {
          loop.start();
          metrics.loopRunning = true;
        }
      },
    });

    window.addEventListener('pagehide', destroy, false);

    window.__playable = {
      funnel: funnel,
      metrics: metrics,
      config: cfg,
      dict: dict,
      ui: ui,
      game: game,
      audio: audio,
      bridge: window.MRAIDBridge,
      locale: locale,
      meanFps: function () { return loop ? loop.meanFps() : 0; },
      resetFpsSamples: function () { if (loop) loop.resetFpsSamples(); },
      isLoopRunning: function () { return !!(loop && loop.running); },
      isAudioSilent: function () {
        return !audio || audio.muted || audio.suspended ||
          !audio.master || audio.master.gain.value === 0;
      },
      forceEnd: function (reason) { if (game) game.end(reason || 'qa'); },
      resolveClickUrl: resolveClickUrl,
      replay: replay,
      relayout: relayout,
      destroy: destroy,
    };
  }

  function boot() {
    loadSprites(cfg.assets).then(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
