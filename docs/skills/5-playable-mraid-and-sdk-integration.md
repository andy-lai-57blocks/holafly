# SKILL 5: MRAID Protocol & Mobile SDK Integration (`playable-mraid-and-sdk-integration`)

## 1. Metadata & Scope
* **Skill Name**: `playable-mraid-and-sdk-integration`
* **Category**: Ad Standards & SDK Lifecycle Integration
* **Version**: 2.0.0 (Clean Standard Edition - No Tre Dependency)
* **Domain Target**: Standard MRAID 2.0 / 3.0 Mobile SDK Playable Container Integration

---

## 2. Core Purpose
Provides robust, standard-compliant MRAID 2.0 and 3.0 lifecycle binding, background state audio muting, canvas suspension, compliant outbound click handling, and standalone browser fallbacks.

---

## 3. Mandatory Rules & Constraints

### 3.1 MRAID Initialization & Readiness
* **[RULE-MRD-001] MRAID Event Binding**: The playable ad MUST check `mraid.getState()` upon load. If the state is `'loading'`, it MUST attach an event listener to `mraid.addEventListener('ready', onReady)`.
* **[RULE-MRD-002] Standalone Environment Fallback**: If `window.mraid` is not defined within **500ms**, the script MUST gracefully fall back to standalone browser mode without throwing uncaught exceptions.

### 3.2 Visibility & Audio Lifecycle Control
* **[RULE-MRD-003] Immediate Suspension on Hidden**: When `viewableChange` returns `false` or `stateChange` switches to `'hidden'`, the ad MUST immediately:
  1. Mute all WebAudio and HTML5 audio contexts.
  2. Pause game loop / requestAnimationFrame execution.
* **[RULE-MRD-004] Resume on Visible**: When visibility is restored (`viewableChange: true`), audio and rendering loops MUST resume smoothly.

### 3.3 Outbound Click Routing & Open Calls
* **[RULE-MRD-005] Strict `mraid.open` Usage**: All outbound app store redirects and CTA clicks MUST be invoked via `mraid.open(clickUrl)` when in an MRAID container.
* **[RULE-MRD-006] Fallback Window Open**: If running outside MRAID, outbound clicks MUST fall back to `window.open(clickUrl, '_blank')`.
* **[RULE-MRD-007] Anti-DOM Tampering**: The playable ad script MUST NEVER attempt to directly access or manipulate `window.parent` or parent SDK DOM elements.

---

## 4. Production MRAID Controller Boilerplate (`MRAIDBridge.js`)

```javascript
/**
 * Clean MRAID 2.0 / 3.0 Controller Boilerplate
 * Self-contained - Zero third-party library dependencies.
 */
(function(window) {
  'use strict';

  var MRAIDBridge = {
    isMraid: false,
    isReady: false,
    isViewable: false,
    config: null,

    init: function(config) {
      this.config = config || {};
      if (typeof window.mraid !== 'undefined') {
        this.isMraid = true;
        if (window.mraid.getState() === 'loading') {
          window.mraid.addEventListener('ready', this._onReady.bind(this));
        } else {
          this._onReady();
        }
      } else {
        console.warn('[MRAIDBridge] MRAID environment not detected. Running in browser mode.');
        this._onReady();
      }
    },

    _onReady: function() {
      this.isReady = true;
      if (this.isMraid) {
        this.isViewable = window.mraid.isViewable ? window.mraid.isViewable() : true;
        window.mraid.addEventListener('viewableChange', this._onViewableChange.bind(this));
        window.mraid.addEventListener('stateChange', this._onStateChange.bind(this));
      } else {
        this.isViewable = true;
      }
      this._notifyGameStart();
    },

    _onViewableChange: function(viewable) {
      this.isViewable = viewable;
      if (viewable) {
        this.onResume();
      } else {
        this.onPause();
      }
    },

    _onStateChange: function(state) {
      if (state === 'hidden') {
        this.onPause();
      } else if (state === 'default' || state === 'expanded') {
        this.onResume();
      }
    },

    _notifyGameStart: function() {
      if (typeof this.config.onGameStart === 'function') {
        this.config.onGameStart();
      }
    },

    onPause: function() {
      if (typeof this.config.onPause === 'function') {
        this.config.onPause();
      }
    },

    onResume: function() {
      if (typeof this.config.onResume === 'function') {
        this.config.onResume();
      }
    },

    openClickthrough: function(url) {
      var targetUrl = url || (this.config.clickUrl ? this.config.clickUrl : '');
      if (!targetUrl) {
        console.error('[MRAIDBridge] No target click URL specified.');
        return;
      }

      if (this.isMraid && typeof window.mraid.open === 'function') {
        window.mraid.open(targetUrl);
      } else {
        window.open(targetUrl, '_blank');
      }
    }
  };

  window.MRAIDBridge = MRAIDBridge;
})(window);
```

---

## 5. QA Verification Checklist (`CHK-MRD`)

| Check ID | Verification Description | Requirement | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| **CHK-MRD-01** | Standard MRAID listener binding | `[RULE-MRD-001]` | **Pass**: Correctly binds to `ready`, `viewableChange`, `stateChange`. |
| **CHK-MRD-02** | Audio/Canvas pause on `viewable: false` | `[RULE-MRD-003]` | **Pass**: Audio stops completely when ad goes to background. |
| **CHK-MRD-03** | Audio/Canvas resume on `viewable: true` | `[RULE-MRD-004]` | **Pass**: Audio/rendering resumes smoothly when re-opened. |
| **CHK-MRD-04** | Outbound routing via `mraid.open()` | `[RULE-MRD-005]` | **Pass**: `mraid.open()` called on CTA tap in SDK environment. |
| **CHK-MRD-05** | Standalone browser fallback | `[RULE-MRD-002]` | **Pass**: Ad runs and links open via `window.open` in standard browser. |
