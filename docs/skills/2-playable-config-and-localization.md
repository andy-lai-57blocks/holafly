# SKILL 2: Dynamic Config & Asset Modularization (`playable-config-and-localization`)

## 1. Metadata & Scope
* **Skill Name**: `playable-config-and-localization`
* **Category**: Content Modularization & Zero-Recompile Mutation
* **Version**: 2.0.0 (Clean Standard Edition - No Tre Dependency)
* **Domain Target**: Cross-Market Playable Packaging & A/B Variants

---

## 2. Core Purpose
Decouples all presentation assets, legal copy, CTA text, colors, and target URLs from the core game engine logic into a unified, extensible `window.PlayableConfig` schema. Enables zero-recompile hot-patching of creative variants, rapid localization (i18n), and campaign-specific tweaks.

---

## 3. Mandatory Rules & Constraints

### 3.1 Zero Hardcoded Strings or Assets
* **[RULE-CFG-001] Separation of Data and Logic**: ZERO user-facing strings, image URLs, colors, or clickthrough destination links may be hardcoded into the core JavaScript codebase.
* **[RULE-CFG-002] Global Config Binding**: All mutable parameters MUST be attached to `window.PlayableConfig` prior to game engine initialization.

### 3.2 Hot-Swappable Asset & Copy Schema
* **[RULE-CFG-003] Modifiable Elements**: The following elements MUST be configurable via JSON without requiring code re-compilation or re-bundling:
  1. Legal disclaimers and T&C text.
  2. Brand Logos, background images, and icon swaps.
  3. CTA button copy, colors, and font styles.
  4. Audio toggle state (default muted vs unmuted).
  5. Gameplay difficulty variables (e.g., timer length, move limit).

### 3.3 Localization (i18n) & Dynamic Layout
* **[RULE-CFG-004] URL Parameter Override**: The config parser MUST read URL query parameters (e.g., `?lang=ja` or `?locale=es`) to dynamically select the corresponding language dictionary.
* **[RULE-CFG-005] Fallback Locale**: If the requested locale is missing, the system MUST gracefully fall back to default English (`en`).
* **[RULE-CFG-006] Auto-Scaling Text Containers**: All UI text containers MUST support variable text lengths (preventing layout clipping or overflow when switching from concise English to longer translated text).

---

## 4. Standard `window.PlayableConfig` Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PlayableConfigSchema",
  "type": "object",
  "properties": {
    "appDetails": {
      "type": "object",
      "properties": {
        "appName": { "type": "string" },
        "appLogo": { "type": "string", "description": "Base64 data URI or image URL" },
        "clickUrl": { "type": "string", "format": "uri" }
      },
      "required": ["appName", "appLogo", "clickUrl"]
    },
    "localization": {
      "type": "object",
      "properties": {
        "defaultLocale": { "type": "string", "default": "en" },
        "locales": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "properties": {
              "ctaText": { "type": "string" },
              "headline": { "type": "string" },
              "legalDisclaimer": { "type": "string" }
            },
            "required": ["ctaText", "headline"]
          }
        }
      },
      "required": ["defaultLocale", "locales"]
    },
    "style": {
      "type": "object",
      "properties": {
        "primaryColor": { "type": "string", "pattern": "^#([A-Fa-f0-9]{6})$" },
        "ctaColor": { "type": "string", "pattern": "^#([A-Fa-f0-9]{6})$" },
        "fontFamily": { "type": "string" }
      }
    },
    "gameplay": {
      "type": "object",
      "properties": {
        "timerSeconds": { "type": "integer", "default": 30 },
        "difficultyLevel": { "type": "string", "enum": ["easy", "medium", "hard"] }
      }
    }
  },
  "required": ["appDetails", "localization"]
}
```

---

## 5. QA Verification Checklist (`CHK-CFG`)

| Check ID | Verification Description | Requirement | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| **CHK-CFG-01** | Zero hardcoded strings in JS source | `[RULE-CFG-001]` | **Pass**: All strings resolved via `PlayableConfig`. |
| **CHK-CFG-02** | Hot-swappable legal disclaimer | `[RULE-CFG-003]` | **Pass**: Modifying `legalDisclaimer` in config updates UI without rebuild. |
| **CHK-CFG-03** | URL query locale override (`?lang=ja`) | `[RULE-CFG-004]` | **Pass**: Japanese copy rendered correctly when `?lang=ja` is appended. |
| **CHK-CFG-04** | Fallback to default `en` locale | `[RULE-CFG-005]` | **Pass**: Unsupported locale (e.g. `?lang=xx`) safely loads English. |
| **CHK-CFG-05** | UI text auto-fit / no clipping | `[RULE-CFG-006]` | **Pass**: Long translated string auto-scales or wraps without overflow. |
