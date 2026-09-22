/* Package runtime — the glue between the two data files the package format
   defines (config.js -> CONFIG, assets.js -> ASSETS) and whatever indirection
   each creative already used for its art and copy. Prepended to every app.js.

   Nothing here is creative-specific: a version plugs in by calling HF.resolve()
   on its own config object and HF.ready() on its own entry point. */
(function (window, document) {
  'use strict';

  var CONFIG = window.CONFIG || (window.CONFIG = {});
  var ASSETS = window.ASSETS || (window.ASSETS = {});

  function bucket(name) { return ASSETS[name] || []; }

  function find(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  // Locale is pinned in config.js. "auto" defers to the device, which ad
  // containers report inconsistently, so fall back to English rather than
  // shipping a half-translated screen.
  function currentLocale() {
    var want = (CONFIG.I18 && CONFIG.I18.locale) || 'en';
    if (want !== 'auto') return want;
    var nav = '';
    try { nav = (navigator.language || '').toLowerCase().split('-')[0]; } catch (e) { /* sandboxed */ }
    var strings = (CONFIG.I18 && CONFIG.I18.strings) || {};
    for (var key in strings) { if (strings[key][nav]) return nav; break; }
    return 'en';
  }

  var locale = currentLocale();

  /** Copy goes through config.js so it can be re-worded without touching code.
   *  Keys are the English source text, which keeps app.js readable. */
  function text(source) {
    var entry = CONFIG.I18 && CONFIG.I18.strings && CONFIG.I18.strings[source];
    if (!entry) return source;
    return entry[locale] || entry.en || source;
  }

  function image(name) {
    var hit = find(bucket('images'), name);
    if (!hit) throw new Error('assets.js has no image "' + name + '"');
    return hit.url;
  }

  function sound(name) {
    var hit = find(bucket('sounds'), name);
    return hit ? hit.url : '';
  }

  /** Same bytes, addressed by an object URL instead of a data URI. Needed
   *  wherever the value lands in an inline style attribute: a data URI's
   *  ";base64," reads as a declaration separator to naive style parsers,
   *  which silently truncates the payload. No network is involved. */
  var blobs = {};
  function blobUrl(name) {
    if (blobs[name]) return blobs[name];
    var uri = image(name);
    var comma = uri.indexOf(',');
    var mime = uri.slice(5, uri.indexOf(';'));
    var binary = atob(uri.slice(comma + 1));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blobs[name] = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return blobs[name];
  }

  /** Walks a config literal and swaps every '__ASSET_name__' placeholder for
   *  the real data URI, so the creative's own config keeps naming art by name.
   *  Strings under `translate` paths additionally go through text(). */
  function resolve(value, translate) {
    if (typeof value === 'string') {
      var asAsset = value.match(/^__ASSET_([a-z0-9-]+)__$/i);
      if (asAsset) return image(asAsset[1]);
      return translate ? text(value) : value;
    }
    if (Array.isArray(value)) {
      var out = [];
      for (var i = 0; i < value.length; i++) out.push(resolve(value[i], translate));
      return out;
    }
    if (value && typeof value === 'object') {
      var obj = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) {
        obj[k] = resolve(value[k], translate);
      }
      return obj;
    }
    return value;
  }

  /** Fonts live in ASSETS like any other payload, so the @font-face rules have
   *  to be assembled here rather than sitting in index.css. */
  function mountFonts(template) {
    if (!template) return;
    var css = template.replace(/__FONT_([a-z0-9-]+)__/gi, function (all, name) {
      var hit = find(bucket('fonts'), name);
      return hit ? hit.url : '';
    });
    var el = document.createElement('style');
    el.setAttribute('data-hf', 'fonts');
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  /** index.html carries markup but no payload; <img data-asset="x"> is filled
   *  in here so the HTML never has to inline a megabyte of base64. */
  function paintAssets(root) {
    var nodes = (root || document).querySelectorAll('[data-asset]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var url = image(el.getAttribute('data-asset'));
      if (el.tagName === 'IMG') el.src = url;
      else el.style.backgroundImage = 'url("' + url + '")';
    }
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /** Store link for the device in hand. Android is the default because that is
   *  where the bulk of playable inventory sits. */
  function storeUrl() {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (e) { /* sandboxed */ }
    var iPadOS = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
    var iOS = /iPhone|iPad|iPod/i.test(ua) || iPadOS;
    if (iOS && CONFIG.appStoreUrl) return CONFIG.appStoreUrl;
    if (!iOS && CONFIG.googlePlayUrl) return CONFIG.googlePlayUrl;
    return CONFIG.googlePlayUrl || CONFIG.appStoreUrl || '';
  }

  window.HF = {
    locale: locale,
    text: text,
    image: image,
    blobUrl: blobUrl,
    sound: sound,
    resolve: resolve,
    mountFonts: mountFonts,
    paintAssets: paintAssets,
    ready: ready,
    storeUrl: storeUrl,
    app: (CONFIG.application || {}),
  };
})(window, document);
