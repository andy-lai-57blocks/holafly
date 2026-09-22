/* Preview shell behaviour. The iframe is always sized to the device's real
   logical resolution and then scaled to fit, so the creative measures a
   genuine viewport instead of adapting to whatever space the page had left. */
(function () {
  'use strict';

  var DEVICES = [
    { id: 'iphone-se', label: 'iPhone SE', kind: 'phone', w: 375, h: 667 },
    { id: 'iphone-15', label: 'iPhone 15', kind: 'phone', w: 393, h: 852 },
    { id: 'iphone-max', label: 'iPhone Pro Max', kind: 'phone', w: 430, h: 932 },
    { id: 'pixel-8', label: 'Pixel 8', kind: 'phone', w: 412, h: 915 },
    { id: 'ipad-mini', label: 'iPad mini', kind: 'tablet', w: 744, h: 1133 },
    { id: 'ipad-pro', label: 'iPad Pro 11"', kind: 'tablet', w: 834, h: 1194 },
  ];

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    version: 0,
    device: 1,
    landscape: false,
    filling: false,
  };

  var el = {
    versions: $('versions'),
    stageInner: document.querySelector('.stage-inner'),
    seg: $('device-seg'),
    device: $('device'),
    frame: $('frame'),
    rotate: $('rotate'),
    rotateLabel: $('rotate-label'),
    reload: $('reload'),
    popout: $('popout'),
    fill: $('fill'),
    fillExit: $('fill-exit'),
    note: $('stage-note'),
    qr: $('qr'),
    qrUrl: $('qr-url'),
    qrWarn: $('qr-warn'),
    metaTitle: $('meta-title'),
    metaDesc: $('meta-desc'),
    metaFiles: $('meta-files'),
  };

  function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

  function currentVersion() { return window.PREVIEW_VERSIONS[state.version]; }
  function currentDevice() { return DEVICES[state.device]; }

  function frameSize() {
    var d = currentDevice();
    return state.landscape ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  }

  /** The QR has to encode an address the phone can actually reach. When the
   *  page is served over loopback that address does not exist off-device, so
   *  the local server injects its LAN origin and we fall back to warning. */
  function shareOrigin() {
    if (window.__PREVIEW_HOST__) return window.__PREVIEW_HOST__.replace(/\/$/, '');
    return location.origin;
  }

  function versionUrl(version, origin) {
    var rel = new URL(version.path, location.href);
    return (origin || shareOrigin()) + rel.pathname + rel.search;
  }

  // ------------------------------------------------------------ rendering

  function buildVersions() {
    window.PREVIEW_VERSIONS.forEach(function (v, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'version';
      b.setAttribute('aria-pressed', String(i === state.version));
      b.innerHTML = '<span class="name"></span><span class="desc"></span><span class="size"></span>';
      b.querySelector('.name').textContent = v.name;
      b.querySelector('.desc').textContent = v.desc;
      b.querySelector('.size').textContent = kb(v.total) + ' · 5 files';
      b.addEventListener('click', function () {
        state.version = i;
        syncVersions();
        loadFrame();
        renderMeta();
        renderQr();
      });
      el.versions.appendChild(b);
    });
  }

  function syncVersions() {
    var nodes = el.versions.children;
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-pressed', String(i === state.version));
  }

  function buildDevices() {
    DEVICES.forEach(function (d, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = d.label;
      b.setAttribute('aria-pressed', String(i === state.device));
      b.addEventListener('click', function () {
        state.device = i;
        syncDevices();
        layout();
      });
      el.seg.appendChild(b);
    });
  }

  function syncDevices() {
    var nodes = el.seg.children;
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-pressed', String(i === state.device));
  }

  /** Give the creative the real viewport instead of a scaled mockup. On a
   *  tablet this is the only honest answer to "does it fill my screen?" — every
   *  device preset is a box in a bezel, scaled down to fit the page. */
  function setFilling(on) {
    state.filling = on;
    document.body.classList.toggle('filling', on);
    el.fillExit.hidden = !on;
    el.fill.setAttribute('aria-pressed', String(on));
    if (on) {
      var root = document.documentElement;
      // Hides the browser chrome too where it is allowed; ignored otherwise.
      if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    layout();
  }

  function layout() {
    var d = currentDevice();
    var size = frameSize();

    // In fill mode the iframe is sized by CSS off the viewport, so the mockup
    // measuring below would only fight it.
    if (state.filling) {
      el.frame.style.width = '';
      el.frame.style.height = '';
      el.device.dataset.kind = d.kind;
      return;
    }

    el.device.dataset.kind = d.kind;
    el.device.dataset.orientation = state.landscape ? 'landscape' : 'portrait';
    el.frame.style.width = size.w + 'px';
    el.frame.style.height = size.h + 'px';

    // Reset before measuring, otherwise the previous scale and the negative
    // margins that go with it skew the box.
    el.device.style.transform = 'scale(1)';
    el.device.style.margin = '0';
    var stage = el.stageInner.getBoundingClientRect();
    var box = el.device.getBoundingClientRect();
    var scale = Math.min(1, (stage.width - 12) / box.width, (stage.height - 12) / box.height);
    el.device.style.transform = 'scale(' + scale + ')';
    // A scaled element keeps its original layout box, which would push the
    // stage around by the difference; pull it back so the frame stays centred
    // and never overflows.
    el.device.style.margin = (-(box.height * (1 - scale)) / 2) + 'px ' +
      (-(box.width * (1 - scale)) / 2) + 'px';

    el.note.textContent = d.label + ' · ' + size.w + ' × ' + size.h + ' CSS px · ' +
      Math.round(scale * 100) + '% scale';
  }

  function loadFrame() {
    var url = currentVersion().path + '?t=' + Date.now();
    el.frame.src = url;
    el.popout.href = currentVersion().path;
  }

  function renderMeta() {
    var v = currentVersion();
    el.metaTitle.textContent = v.name;
    el.metaDesc.textContent = v.desc;
    el.metaFiles.innerHTML = '';
    Object.keys(v.files).forEach(function (name) {
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = name;
      dd.textContent = kb(v.files[name]);
      el.metaFiles.appendChild(dt);
      el.metaFiles.appendChild(dd);
    });
    var dt = document.createElement('dt');
    var dd = document.createElement('dd');
    dt.textContent = 'total';
    dd.textContent = kb(v.total);
    dt.className = dd.className = 'total';
    el.metaFiles.appendChild(dt);
    el.metaFiles.appendChild(dd);
  }

  function renderQr() {
    var url = versionUrl(currentVersion());
    el.qrUrl.textContent = url;

    var loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
    el.qrWarn.hidden = !loopback;
    if (loopback) {
      el.qrWarn.textContent = 'This address only resolves on this computer. Serve the preview with '
        + '"npm run preview" to get a scannable address on your network, or host the dist/ folder.';
    }

    window.QRCodeLib.toCanvas(el.qr, url, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#131a33ff', light: '#ffffffff' },
    }, function (err) {
      if (err) { console.error('[preview] QR failed:', err); return; }
      // The encoder pins the canvas to its render size with inline styles.
      // Drop them so the stylesheet can scale it to the card.
      el.qr.style.width = '';
      el.qr.style.height = '';
    });
  }

  // -------------------------------------------------------------- wiring

  el.rotate.addEventListener('click', function () {
    state.landscape = !state.landscape;
    el.rotate.setAttribute('aria-pressed', String(state.landscape));
    el.rotateLabel.textContent = state.landscape ? 'Landscape' : 'Portrait';
    layout();
  });

  el.reload.addEventListener('click', loadFrame);

  el.fill.addEventListener('click', function () { setFilling(!state.filling); });
  el.fillExit.addEventListener('click', function () { setFilling(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.filling) setFilling(false);
  });
  // Leaving fullscreen by a browser gesture has to drop the layout with it.
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && state.filling) setFilling(false);
  });

  // The stage changes size for reasons the window never hears about — the
  // sidebar reflowing, a scrollbar appearing, the panel growing. Watch the box
  // itself so the frame is never left clipped.
  if (window.ResizeObserver) {
    var pending = false;
    new ResizeObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; layout(); });
    }).observe(el.stageInner);
  } else {
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 80);
    });
  }

  buildVersions();
  buildDevices();
  loadFrame();
  renderMeta();
  renderQr();
  layout();
})();
