/**
 * S5 — DOM overlay: HUD, idle affordance, banners, endcard, CTA surfaces.
 *
 * Text and colour arrive from PlayableConfig only. The overlay is DOM rather
 * than canvas so that translated copy can reflow and auto-fit, which canvas
 * text cannot do without reimplementing line breaking (RULE-CFG-006).
 */
(function (window) {
  'use strict';

  var LOCALE_PARAMS = ['lang', 'locale', 'language'];

  function resolveLocale(config, search) {
    var loc = config.localization;
    var params = new URLSearchParams(search || '');
    var requested = null;
    for (var i = 0; i < LOCALE_PARAMS.length; i++) {
      var v = params.get(LOCALE_PARAMS[i]);
      if (v) { requested = v; break; }
    }

    if (requested) {
      var lower = requested.toLowerCase();
      if (loc.locales[lower]) return lower;
      // `pt-BR` should find `pt` before giving up (RULE-CFG-005).
      var base = lower.split(/[-_]/)[0];
      if (loc.locales[base]) return base;
    }
    if (loc.locales[loc.defaultLocale]) return loc.defaultLocale;
    return 'en';
  }

  function Dictionary(config, locale) {
    this.config = config;
    this.locale = locale;
    this.strings = config.localization.locales[locale] || {};
    this.fallback = config.localization.locales[config.localization.defaultLocale]
      || config.localization.locales.en || {};
  }

  Dictionary.prototype.t = function (key, vars) {
    var raw = this.strings[key];
    if (raw == null) raw = this.fallback[key];
    if (raw == null) return '';
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, function (all, name) {
      return vars[name] != null ? vars[name] : all;
    });
  };

  Dictionary.prototype.place = function (key) {
    var places = this.strings.places || this.fallback.places || {};
    return places[key] || (this.fallback.places || {})[key] || key;
  };

  Dictionary.prototype.hazard = function (kind) {
    var banners = this.strings.hazardBanners || this.fallback.hazardBanners || {};
    return banners[kind] || (this.fallback.hazardBanners || {})[kind] || '';
  };

  /**
   * Shrinks a single-line element until it fits its box. Spanish and Japanese
   * headlines run materially longer than the English they were laid out for,
   * and a clipped CTA is a dead CTA.
   */
  function fitText(el, maxPx, minPx) {
    if (!el || !el.isConnected) return;
    el.style.fontSize = maxPx + 'px';
    var size = maxPx;
    // Binary search would need a reflow per probe anyway; a bounded linear
    // walk is simpler and runs a handful of times per layout, not per frame.
    while (size > minPx && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }

  function debounce(fn, waitMs) {
    var last = 0;
    return function () {
      var now = Date.now();
      if (now - last < waitMs) return false;
      last = now;
      return fn.apply(this, arguments);
    };
  }

  function UI(opts) {
    this.config = opts.config;
    this.dict = opts.dict;
    this.root = opts.root;
    this.onCta = opts.onCta;
    this.onReplay = opts.onReplay;

    this.el = {};
    this._bannerTimer = 0;
    this._idleTimer = 0;
    this._bound = [];

    this._build();
    this._applyStyle();
    this.applyCopy();
    this._bindControls();
  }

  UI.prototype._build = function () {
    var root = this.root;
    var q = function (sel) { return root.querySelector(sel); };
    this.el = {
      stage: q('#stage'),
      hud: q('#hud'),
      hudWordmark: q('#hud-wordmark'),
      meterPill: q('#meter-pill'),
      meterBars: root.querySelectorAll('#meter-bars .bar'),
      meterNum: q('#meter-num'),
      meterLabel: q('#meter-label'),
      destCount: q('#dest-count'),
      destLabel: q('#dest-label'),
      banner: q('#banner'),
      hookOverlay: q('#hook-overlay'),
      hookHeadline: q('#hook-headline'),
      hookHeadlineSub: q('#hook-headline-sub'),
      idleHint: q('#idle-hint'),
      idleHintText: q('#idle-hint-text'),
      liveCta: q('#live-cta'),
      endcard: q('#endcard'),
      endWordmark: q('#end-wordmark'),
      endHeadline: q('#end-headline'),
      endHeadlineSub: q('#end-headline-sub'),
      endBody: q('#end-body'),
      endLogo: q('#end-logo'),
      endCta: q('#end-cta'),
      endReplay: q('#end-replay'),
      endReplayText: q('#end-replay-text'),
      legal: q('#legal'),
      statDest: q('#stat-dest-value'),
      statDestLabel: q('#stat-dest-label'),
      statData: q('#stat-data-value'),
      statDataLabel: q('#stat-data-label'),
      statUptime: q('#stat-uptime-value'),
      statUptimeLabel: q('#stat-uptime-label'),
    };
  };

  /** Publishes config.style as CSS custom properties so the stylesheet holds
   * no brand values of its own (RULE-CFG-001). */
  UI.prototype._applyStyle = function () {
    var s = this.config.style;
    var css = this.root.style;
    css.setProperty('--coral-top', s.coralTop);
    css.setProperty('--coral-bottom', s.coralBottom);
    css.setProperty('--maroon', s.maroon);
    css.setProperty('--cta', s.ctaColor);
    css.setProperty('--cta-text', s.ctaTextColor);
    css.setProperty('--primary', s.primaryColor);
    css.setProperty('--green', s.accentGreen);
    css.setProperty('--yellow', s.accentYellow);
    css.setProperty('--gold', s.gold);
    css.setProperty('--ink', s.ink);
    css.setProperty('--white', s.white);
    css.setProperty('--font', s.fontFamily);
    css.setProperty('--legal-size', s.legalFontSizePx + 'px');
    css.setProperty('--corner-reserve', s.cornerReservePx + 'px');

    var assets = this.config.assets;
    this.el.hudWordmark.src = assets.wordmark;
    this.el.endWordmark.src = assets.wordmark;
    this.el.endLogo.src = this.config.appDetails.appLogo;
    var alt = this.config.appDetails.appName;
    this.el.hudWordmark.alt = alt;
    this.el.endWordmark.alt = alt;
    this.el.endLogo.alt = alt;
  };

  UI.prototype.applyCopy = function () {
    var t = this.dict.t.bind(this.dict);
    this.el.meterLabel.textContent = t('meterLabel');
    this.el.destLabel.textContent = t('destinationsLabel');
    this.el.idleHintText.textContent = t('hookHint');
    this.el.hookHeadline.textContent = t('headline');
    this.el.hookHeadlineSub.textContent = t('headlineSub');
    this.el.liveCta.textContent = t('ctaText');
    this.el.endCta.textContent = t('ctaText');
    this.el.endReplayText.textContent = t('replayText');
    this.el.endHeadline.textContent = t('endHeadline');
    this.el.endHeadlineSub.textContent = t('endHeadlineSub');
    this.el.endBody.textContent = t('endBody');
    this.el.statDestLabel.textContent = t('statDestinations');
    this.el.statDataLabel.textContent = t('statData');
    this.el.statUptimeLabel.textContent = t('statUptime');
    this.el.legal.textContent = t('legalDisclaimer');
    this.root.setAttribute('lang', this.dict.locale);
    this.refit();
  };

  UI.prototype.refit = function () {
    var box = this.root.getBoundingClientRect();
    var base = Math.max(18, Math.min(box.width * 0.115, box.height * 0.062));
    fitText(this.el.hookHeadline, base * 0.86, 13);
    fitText(this.el.hookHeadlineSub, base * 0.86, 13);
    fitText(this.el.endHeadline, base, 13);
    fitText(this.el.endHeadlineSub, base, 13);
    fitText(this.el.endCta, Math.max(15, base * 0.5), 12);
    fitText(this.el.liveCta, Math.max(13, base * 0.4), 10);
  };

  UI.prototype._bindControls = function () {
    var self = this;
    var add = function (el, type, fn) {
      el.addEventListener(type, fn, false);
      self._bound.push([el, type, fn]);
    };

    // One shared debounced handler across both CTA surfaces, so hammering the
    // live CTA and the endcard CTA together still yields a single open.
    var fire = debounce(function (source) {
      if (self.onCta) self.onCta(source);
      return true;
    }, this.config.gameplay.ctaDebounceMs);

    var ctaTap = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      fire(ev.currentTarget.id);
    };
    add(this.el.liveCta, 'click', ctaTap);
    add(this.el.endCta, 'click', ctaTap);

    add(this.el.endReplay, 'click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (self.onReplay) self.onReplay();
    });
  };

  UI.prototype.setMeter = function (percent) {
    var pct = Math.max(0, Math.min(100, percent));
    this.el.meterNum.textContent = Math.round(pct) + '%';
    var lit = Math.ceil(pct / 20);
    for (var i = 0; i < this.el.meterBars.length; i++) {
      this.el.meterBars[i].classList.toggle('on', i < lit);
    }
    this.el.meterNum.classList.toggle('low', pct < 25);
  };

  /**
   * Held for as long as the runner is in a coverage hole. The canvas already
   * says the signal is gone; this says which number is paying for it, which is
   * the half of the message the product cares about.
   */
  UI.prototype.setSignalLoss = function (lost) {
    this.el.meterPill.classList.toggle('nosignal', !!lost);
  };

  UI.prototype.setDestinations = function (count) {
    this.el.destCount.textContent = String(count);
  };

  UI.prototype.banner = function (text, tone) {
    var el = this.el.banner;
    el.textContent = text;
    el.dataset.tone = tone || 'neutral';
    el.classList.remove('show');
    // Force a reflow so the animation restarts on a repeated banner.
    void el.offsetWidth;
    el.classList.add('show');
    window.clearTimeout(this._bannerTimer);
    this._bannerTimer = window.setTimeout(function () {
      el.classList.remove('show');
    }, 1400);
  };

  /** RULE-CVR-003: armed on entering gameplay, cancelled by the first touch. */
  UI.prototype.armIdleHint = function (delayMs) {
    var self = this;
    this.cancelIdleHint();
    this._idleTimer = window.setTimeout(function () {
      self.el.idleHint.classList.add('show');
    }, delayMs);
  };

  UI.prototype.cancelIdleHint = function () {
    window.clearTimeout(this._idleTimer);
    this._idleTimer = 0;
    this.el.idleHint.classList.remove('show');
  };

  UI.prototype.hideHook = function () {
    this.el.hookOverlay.classList.add('hide');
  };

  UI.prototype.showEndcard = function (stats) {
    this.el.statDest.textContent = String(stats.destinations);
    this.el.statData.textContent = String(stats.orbs);
    this.el.statUptime.textContent = stats.uptime + '%';
    this.el.endcard.hidden = false;
    void this.el.endcard.offsetWidth;
    this.el.endcard.classList.add('show');
    this.el.hud.classList.add('dim');
    this.refit();
  };

  UI.prototype.hideEndcard = function () {
    this.el.endcard.classList.remove('show');
    this.el.endcard.hidden = true;
    this.el.hud.classList.remove('dim');
    this.el.hookOverlay.classList.remove('hide');
  };

  UI.prototype.destroy = function () {
    this._bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2], false); });
    this._bound.length = 0;
    window.clearTimeout(this._bannerTimer);
    window.clearTimeout(this._idleTimer);
  };

  window.PlayableUI = {
    UI: UI,
    Dictionary: Dictionary,
    resolveLocale: resolveLocale,
    fitText: fitText,
    debounce: debounce,
  };
})(window);
