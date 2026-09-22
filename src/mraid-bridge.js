/**
 * S6 SDK_BIND — MRAID 2.0 / 3.0 lifecycle bridge.
 *
 * Built on the skill's reference controller, with the 500ms standalone
 * watchdog that RULE-MRD-002 requires and a hardened `ready` path: some
 * containers inject `window.mraid` after document parse, so a one-shot probe at
 * load can miss it entirely and strand the creative in browser mode.
 */
(function (window) {
  'use strict';

  var STANDALONE_TIMEOUT_MS = 500;
  var PROBE_INTERVAL_MS = 30;

  var MRAIDBridge = {
    isMraid: false,
    isReady: false,
    isViewable: false,
    startDeferred: false,
    config: null,
    _started: false,
    _probeTimer: null,
    _watchdog: null,

    init: function (config) {
      this.config = config || {};

      if (typeof window.mraid !== 'undefined') {
        this._bind();
        return;
      }

      // Poll briefly for a late-injected bridge, then give up and run
      // standalone rather than throwing (RULE-MRD-002).
      var self = this;
      var elapsed = 0;
      this._probeTimer = window.setInterval(function () {
        elapsed += PROBE_INTERVAL_MS;
        if (typeof window.mraid !== 'undefined') {
          self._clearTimers();
          self._bind();
        } else if (elapsed >= STANDALONE_TIMEOUT_MS) {
          self._clearTimers();
          self._onReady();
        }
      }, PROBE_INTERVAL_MS);

      this._watchdog = window.setTimeout(function () {
        self._clearTimers();
        if (!self.isReady) self._onReady();
      }, STANDALONE_TIMEOUT_MS + PROBE_INTERVAL_MS);
    },

    _clearTimers: function () {
      if (this._probeTimer) { window.clearInterval(this._probeTimer); this._probeTimer = null; }
      if (this._watchdog) { window.clearTimeout(this._watchdog); this._watchdog = null; }
    },

    _bind: function () {
      this.isMraid = true;
      try {
        if (window.mraid.getState() === 'loading') {
          window.mraid.addEventListener('ready', this._onReady.bind(this));
        } else {
          this._onReady();
        }
      } catch (err) {
        // A malformed bridge must not take the creative down with it.
        this.isMraid = false;
        this._onReady();
      }
    },

    /** MRAID 2.0 exposes a method, 3.0 a property. Containers ship both. */
    _readViewable: function () {
      try {
        var m = window.mraid;
        if (typeof m.isViewable === 'function') return !!m.isViewable();
        if (typeof m.viewable === 'boolean') return m.viewable;
      } catch (err) { /* fall through */ }
      return true;
    },

    _onReady: function () {
      if (this.isReady) return;
      this.isReady = true;

      if (this.isMraid) {
        try {
          this.isViewable = this._readViewable();
          window.mraid.addEventListener('viewableChange', this._onViewableChange.bind(this));
          window.mraid.addEventListener('stateChange', this._onStateChange.bind(this));
        } catch (err) {
          this.isViewable = true;
        }
      } else {
        this.isViewable = true;
      }

      if (typeof this.config.onReady === 'function') this.config.onReady(this);

      // Containers preload a playable and hold it off-screen until the
      // publisher has a slot for it, which can be tens of seconds. Starting at
      // `ready` spends the opening hook where nobody can see it, so the run
      // waits for the first viewable moment instead. Reading the flag here
      // rather than relying on `viewableChange` alone matters because some
      // exchanges never fire it for an ad that was already viewable on load.
      if (this.isViewable) this._notifyGameStart();
      else this.startDeferred = true;
    },

    _onViewableChange: function (viewable) {
      this.isViewable = !!viewable;
      if (!this.isViewable) { this.onPause(); return; }
      // First time on screen is a start, not a resume: there is nothing to
      // resume yet, and `onResume` would run the loop with no timebase.
      if (this._started) this.onResume();
      else this._notifyGameStart();
    },

    _onStateChange: function (state) {
      if (state === 'hidden') { this.onPause(); return; }
      if (state !== 'default' && state !== 'expanded') return;
      // Belt and braces for a container that moves state but forgets
      // `viewableChange` — without this the creative would hang unstarted.
      if (this._started) this.onResume();
      else if (this._readViewable()) this._notifyGameStart();
    },

    _notifyGameStart: function () {
      if (this._started) return;
      this._started = true;
      if (typeof this.config.onGameStart === 'function') {
        // Tells boot whether the player has been looking at the first frame
        // since load, or has only just been shown the creative.
        this.config.onGameStart({ deferred: !!this.startDeferred });
      }
    },

    onPause: function () {
      if (typeof this.config.onPause === 'function') this.config.onPause();
    },

    onResume: function () {
      if (typeof this.config.onResume === 'function') this.config.onResume();
    },

    openClickthrough: function (url) {
      // Liftoff resolves the store destination itself and attributes the click
      // against the campaign, so when its API is present it outranks anything
      // baked into the creative. It calls mraid.open underneath.
      if (window.Liftoff && typeof window.Liftoff.open === 'function') {
        window.Liftoff.open();
        return true;
      }

      var targetUrl = url || (this.config.clickUrl ? this.config.clickUrl : '');
      if (!targetUrl) return false;

      if (this.isMraid && window.mraid && typeof window.mraid.open === 'function') {
        window.mraid.open(targetUrl);
      } else {
        window.open(targetUrl, '_blank');
      }
      return true;
    },

    destroy: function () {
      this._clearTimers();
      if (this.isMraid && window.mraid && window.mraid.removeEventListener) {
        try {
          window.mraid.removeEventListener('viewableChange');
          window.mraid.removeEventListener('stateChange');
        } catch (err) { /* container already torn down */ }
      }
    },
  };

  window.MRAIDBridge = MRAIDBridge;
})(window);
