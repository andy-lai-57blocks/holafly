# Agent Workflow — Holafly Branding Playable Ad

**Campaign**: Holafly eSIM — "Stay connected wherever you go"
**Creative format**: Single-file HTML5 playable (endless runner)
**Skill contract**: `playable-hook-and-conversion` · `playable-config-and-localization` ·
`playable-brand-and-compliance` · `playable-performance-and-responsive` ·
`playable-mraid-and-sdk-integration`

This document is the executable spec. Every stage declares its inputs, its outputs, the skill
rules it must satisfy, and a hard gate. A stage may not be marked complete while its gate fails —
the workflow rolls back to the owning stage instead of proceeding.

---

## 0. Agent roles

The pipeline is executed by one orchestrator delegating to five specialist roles. Roles are
capability boundaries, not necessarily separate processes: a single agent may hold several, but the
gate for a stage must be evaluated against the stage's own rule set only.

| Role | Owns | Skill authority |
| :--- | :--- | :--- |
| `orchestrator` | Stage sequencing, gate arbitration, rollback | — |
| `brand-auditor` | Palette/type/logo extraction, compliance veto | `playable-brand-and-compliance` |
| `creative-architect` | Hook design, funnel state machine, CTA copy | `playable-hook-and-conversion` |
| `config-engineer` | `window.PlayableConfig` schema, i18n dictionaries | `playable-config-and-localization` |
| `perf-engineer` | Asset budgets, render loop, responsive layout, bundling | `playable-performance-and-responsive` |
| `sdk-engineer` | MRAID lifecycle, clickthrough routing, fallbacks | `playable-mraid-and-sdk-integration` |

The `brand-auditor` holds a **veto**: it can fail the final gate independently of every other
role, because brand and legal defects are not recoverable post-ship.

---

## 1. Pipeline

```
S0 INTAKE ─► S1 BRAND_HARVEST ─► S2 CREATIVE_BRIEF ─► S3 CONFIG_SCAFFOLD
                                                            │
                     ┌──────────────────────────────────────┘
                     ▼
              S4 ASSET_FORGE ─► S5 ENGINE_BUILD ─► S6 SDK_BIND ─► S7 INLINE_BUNDLE
                                                                        │
                                                   ┌────────────────────┘
                                                   ▼
                                            S8 QA_GATE ──(fail)──► rollback to owning stage
                                                   │
                                                 (pass)
                                                   ▼
                                                S9 SHIP
```

### S0 — INTAKE

**Owner** `orchestrator`

Resolve the campaign inputs before any code exists, so that later stages never guess.

- Store listing URL → app id, app name, developer, category, content rating, IAP flags.
- Target placement (MRAID 2.0/3.0 in-app), target orientation set (portrait + landscape).
- Locale matrix for the campaign.
- Clickthrough destination.

**Gate G0**: app id, app name, clickthrough URL, content rating and locale matrix are all
resolved to concrete values. No placeholder tokens survive this stage.

Resolved for this campaign:

| Field | Value |
| :--- | :--- |
| App id | `com.holafly.holafly` |
| App name | Holafly eSIM: Unlimited Data |
| Content rating | Everyone (→ `coppaComplianceRequired: false`, no child-directed gate) |
| IAP / paid content | Yes — prepaid eSIM plans are purchased in-app |
| Locales | `en`, `es`, `ja`, `zh` |
| Clickthrough | Google Play listing for `com.holafly.holafly` |

### S1 — BRAND_HARVEST

**Owner** `brand-auditor` · **Rules** `RULE-CMP-001`, `RULE-CMP-002`

Brand fidelity is derived from primary sources, never from memory or approximation.

1. Pull the store listing HTML; enumerate every `play-lh.googleusercontent.com` asset and
   classify by dimension (icon vs. phone screenshot vs. unrelated cross-promo tile).
2. Sample the real pixels of the icon and screenshots to recover the palette. Sample **region
   modes**, not single pixels — gradients and JPEG ringing make single-pixel reads lie.
3. Recover the official webfont from the brand's own domain rather than substituting a
   lookalike from a free font host. A visually similar substitute fails `RULE-CMP-001`.
4. Cross-check the sampled palette against the brand site's CSS custom properties; the CSS token
   is authoritative where the two disagree, because screenshot pixels carry compression drift.
5. Freeze everything into `brand/brand-tokens.json`. Downstream stages read tokens only —
   no stage may re-derive a colour.

**Gate G1**: every token in `brand-tokens.json` carries a `source` field naming the primary
artefact it came from. A token without provenance is a compliance defect.

### S2 — CREATIVE_BRIEF

**Owner** `creative-architect` · **Rules** `RULE-CVR-001`, `RULE-CVR-002`, `RULE-CVR-005`, `RULE-CVR-006`

The anti-fake-ad rule is the binding constraint on game design, and it is enforced structurally:
**every interactive noun in the game must trace to a feature that actually exists in the
advertised product.** The brief is not approved until that mapping table is complete.

| Game element | Real product feature (source) | Rule |
| :--- | :--- | :--- |
| Runner stays connected while moving between countries | "Stay connected wherever you go" — store hero screenshot | `RULE-CVR-001` |
| `∞` data orbs restore the signal meter | "True Unlimited Data · No hidden caps" — store screenshot | `RULE-CVR-002` |
| Country flag gates advance the destination | "200+ destinations", in-app Short trips list | `RULE-CVR-002` |
| Roaming-bill obstacle drains the meter | "No roaming fees / No roaming charges" — store screenshot | `RULE-CVR-002` |
| Signal meter never empties to a hard fail | "Always On: free monthly backup data" — in-app card | `RULE-CVR-002` |
| HolaCoins pickups | HolaCoins tab in the app's bottom navigation | `RULE-CVR-002` |

Design constraints the brief must also satisfy:

- Playable teaches its own control in ≤ 1 gesture. One-touch jump; no tutorial text wall.
- First destination gate must be reachable inside the first 5 seconds so the value proposition
  ("you crossed a border and stayed online") lands within the hook window.
- No hard lose state. A depleted meter triggers the *Always On* rescue once — which is both
  better funnel behaviour and a true statement about the product.
- Gameplay hard-capped at 30 s, then auto-transition to endcard.

**Gate G2**: the mapping table has zero rows whose "real product feature" column is empty or
speculative, and the funnel state machine enumerates exactly the states in
`PlayableFunnelState`.

### S3 — CONFIG_SCAFFOLD

**Owner** `config-engineer` · **Rules** `RULE-CFG-001` … `RULE-CFG-006`

Build `window.PlayableConfig` **before** the engine, so the engine is physically unable to
hardcode. The ordering is the enforcement mechanism: an engine written second against an
existing config has nowhere to put a literal.

- Config is assigned to `window.PlayableConfig` in a script block that precedes the engine block.
- Engine reads copy exclusively through a single `t(key)` resolver and style exclusively through
  CSS custom properties generated from `config.style`.
- Locale selection: `?lang=` / `?locale=` query param → config `defaultLocale` → `en`.
- Difficulty, timers, meter drain rates, spawn weights all live in `config.gameplay`.

**Gate G3**: a grep of the engine source for quoted human-language strings returns only key
names and debug logs. Any user-visible literal fails the gate.

### S4 — ASSET_FORGE

**Owner** `perf-engineer` + `brand-auditor` · **Rules** `RULE-PRF-004`, `RULE-PRF-005`, `RULE-CMP-001`

Two asset classes, chosen per-asset by which one survives scaling better:

- **Harvested raster** — brand marks and the store creative's sticker illustrations. These are
  *identity*; they must be the real artwork. Crop from the screenshot, chroma-key the coral
  background to alpha, trim, resize to power-of-two-ish targets ≤ 1024 px, encode WebP.
- **Procedural vector** — runner, terrain, clouds, sparkles, HUD. These are *motion*; they must
  stay crisp at any device pixel ratio and cost zero bytes. Drawn on canvas from brand tokens,
  in the store creative's flat-fill + white-outline sticker idiom.

Font handling: subset the official WOFF2 to the exact glyph set used across **all** locales, so
`RULE-PRF-003`'s 200 KB bootstrap budget is respected without dropping the brand typeface.

**Gate G4**: no source image exceeds 1024 px on either axis; every raster is WebP; the manifest
records byte size per asset and the total is within the S7 budget.

### S5 — ENGINE_BUILD

**Owner** `perf-engineer` + `creative-architect` · **Rules** `RULE-CVR-003`, `RULE-CVR-004`, `RULE-CVR-008`, `RULE-CVR-009`, `RULE-PRF-007` … `RULE-PRF-011`

- Fixed-timestep simulation decoupled from render, so physics is frame-rate independent and the
  30 s cap means 30 s of wall clock on every device.
- Object pooling for all spawned entities; zero allocation in the steady-state frame.
- Idle hint armed at 1500 ms, cancelled on `touchstart`/`mousedown`/`keydown`.
- Layout driven by `ResizeObserver` + `orientationchange`, with `env(safe-area-inset-*)` padding.
- Canvas backing store capped at DPR 2 to bound fill cost on high-DPR mid-tier hardware.
- Teardown path removes every listener, cancels the RAF, and closes the audio context.

**Gate G5**: instrumented run reports mean FPS ≥ 50; a teardown leaves zero live listeners and
zero pending frames.

### S6 — SDK_BIND

**Owner** `sdk-engineer` · **Rules** `RULE-MRD-001` … `RULE-MRD-007`

- `mraid.getState()` probed on load; `ready` listener attached when `loading`.
- 500 ms watchdog → standalone browser mode, no uncaught exception.
- `viewableChange:false` / `stateChange:'hidden'` → mute audio **and** pause the loop in the
  same tick.
- CTA → `mraid.open()` inside a container, `window.open(url,'_blank')` outside.
- Zero reads or writes of `window.parent`.

**Gate G6**: the five `CHK-MRD` checks pass under a mock MRAID harness and under no-MRAID.

### S7 — INLINE_BUNDLE

**Owner** `perf-engineer` · **Rules** `RULE-PRF-001`, `RULE-PRF-002`, `RULE-PRF-003`

Deterministic build step inlines config, engine, fonts, and sprites into one `.html`.

**Gate G7**: the artefact contains zero external URL references in any loadable position, and
total size ≤ 2 MB.

### S8 — QA_GATE

**Owner** `orchestrator`, with `brand-auditor` veto

All 25 checklist items from the five skills are executed as automated assertions against the
built artefact. This is a gate, not a report: a single failure blocks S9 and routes back to the
owning stage.

### S9 — SHIP

Emit the artefact plus a signed QA report enumerating all 25 checks with their measured values.

---

## 2. Machine-readable pipeline

```json
{
  "workflow": "holafly-playable-branding-ad",
  "version": "1.0.0",
  "artifact": "dist/holafly-playable.html",
  "stages": [
    { "id": "S0", "name": "INTAKE",         "owner": "orchestrator",     "skills": [],                                  "gate": "G0", "outputs": ["campaign.json"] },
    { "id": "S1", "name": "BRAND_HARVEST",  "owner": "brand-auditor",    "skills": ["playable-brand-and-compliance"],   "gate": "G1", "outputs": ["brand/brand-tokens.json", "assets/raw/*"] },
    { "id": "S2", "name": "CREATIVE_BRIEF", "owner": "creative-architect","skills": ["playable-hook-and-conversion"],   "gate": "G2", "outputs": ["AGENT_WORKFLOW.md#S2"] },
    { "id": "S3", "name": "CONFIG_SCAFFOLD","owner": "config-engineer",  "skills": ["playable-config-and-localization"],"gate": "G3", "outputs": ["src/config.js"] },
    { "id": "S4", "name": "ASSET_FORGE",    "owner": "perf-engineer",    "skills": ["playable-performance-and-responsive","playable-brand-and-compliance"], "gate": "G4", "outputs": ["assets/sprites/*.webp", "assets/fonts/*.subset.woff2", "assets/manifest.json"] },
    { "id": "S5", "name": "ENGINE_BUILD",   "owner": "perf-engineer",    "skills": ["playable-performance-and-responsive","playable-hook-and-conversion"], "gate": "G5", "outputs": ["src/engine.js", "src/game.js", "src/ui.js"] },
    { "id": "S6", "name": "SDK_BIND",       "owner": "sdk-engineer",     "skills": ["playable-mraid-and-sdk-integration"], "gate": "G6", "outputs": ["src/mraid-bridge.js"] },
    { "id": "S7", "name": "INLINE_BUNDLE",  "owner": "perf-engineer",    "skills": ["playable-performance-and-responsive"], "gate": "G7", "outputs": ["dist/holafly-playable.html"] },
    { "id": "S8", "name": "QA_GATE",        "owner": "orchestrator",     "skills": ["*"],                               "gate": "G8", "outputs": ["dist/qa-report.json"] },
    { "id": "S9", "name": "SHIP",           "owner": "orchestrator",     "skills": [],                                  "gate": null, "outputs": ["dist/"] }
  ],
  "gates": {
    "G0": { "assert": "campaign fields non-placeholder" },
    "G1": { "assert": "every brand token has provenance" },
    "G2": { "assert": "every game element maps to a real product feature" },
    "G3": { "assert": "zero user-facing literals in engine source" },
    "G4": { "assert": "textures <= 1024px, WebP only, manifest complete" },
    "G5": { "assert": "meanFps >= 50 && leaks == 0" },
    "G6": { "assert": "CHK-MRD-01..05 pass in mraid and standalone" },
    "G7": { "assert": "externalRefs == 0 && bytes <= 2097152" },
    "G8": { "assert": "all 25 CHK pass", "veto": "brand-auditor" }
  },
  "rollback": {
    "policy": "route-to-owning-stage",
    "maxAttemptsPerStage": 3,
    "onExhaustion": "halt-and-escalate"
  }
}
```

---

## 3. Rule → implementation traceability

Each of the 27 mandatory rules maps to a named implementation site. An unmapped rule is a gap.

| Rule | Implementation site |
| :--- | :--- |
| `RULE-CVR-001` | `game.js` opening sequence: runner already moving, first flag gate < 5 s |
| `RULE-CVR-002` | S2 mapping table; every entity type traces to a store-listed feature |
| `RULE-CVR-003` | `ui.js` `IdleHint`, armed at `config.gameplay.idleTimeoutMs` = 1500 |
| `RULE-CVR-004` | `IdleHint.cancel()` bound to `touchstart` / `mousedown` / `keydown` |
| `RULE-CVR-005` | `game.js` `maxGameplayDurationMs` = 30000 hard cap |
| `RULE-CVR-006` | `funnel.transition('ENDCARD')` from win / rescue-exhausted / cap |
| `RULE-CVR-007` | Persistent CTA rendered in gameplay HUD and endcard |
| `RULE-CVR-008` | `ui.js` `debounce(1000)` wrapper on every CTA surface |
| `RULE-CVR-009` | CSS `min-width/min-height: 44px` on `.cta`, `.hud-cta` |
| `RULE-CFG-001` | All copy via `t()`; all colour via CSS vars from `config.style` |
| `RULE-CFG-002` | `config.js` inlined before `engine.js` in bundle order |
| `RULE-CFG-003` | `config.localization`, `config.style`, `config.audio`, `config.gameplay` |
| `RULE-CFG-004` | `resolveLocale()` reads `?lang=` / `?locale=` |
| `RULE-CFG-005` | `resolveLocale()` falls back to `config.localization.defaultLocale` → `en` |
| `RULE-CFG-006` | `fitText()` binary-search autoscale + flex wrap on all text containers |
| `RULE-CMP-001` | `brand-tokens.json` from primary sources; official Modern Era webfont |
| `RULE-CMP-002` | No dated promo copy, no price claims, no seasonal theming in config |
| `RULE-CMP-003` | `.legal` at 11px with measured contrast ≥ 4.5:1 |
| `RULE-CMP-004` | `legalDisclaimer` carries the in-app-purchase disclosure |
| `RULE-CMP-005` | Rating is Everyone, not child-directed; zero tracking pixels, zero identifiers |
| `RULE-CMP-006` | No simulated OS chrome; the phone frame is clearly in-world game art |
| `RULE-CMP-007` | No `X` / close glyph anywhere in the payload |
| `RULE-PRF-001` | `tools/build.mjs` inlines CSS, JS, fonts, sprites |
| `RULE-PRF-002` | Build fails hard above 2 MB |
| `RULE-PRF-003` | Subset fonts; bootstrap non-JS payload measured at build time |
| `RULE-PRF-004` | Extractor clamps every sprite to ≤ 1024 px |
| `RULE-PRF-005` | `cwebp` encode; SVG/procedural elsewhere |
| `RULE-PRF-006` | WebAudio synthesis — 0 bytes of audio payload, trivially under 150 KB |
| `RULE-PRF-007` | `layout()` recomputes on resize/orientation; portrait and landscape composition |
| `RULE-PRF-008` | `env(safe-area-inset-*)` on the root container |
| `RULE-PRF-009` | Fixed-timestep loop, pooled entities, DPR clamp |
| `RULE-PRF-010` | Inline critical CSS; first paint before engine parse |
| `RULE-PRF-011` | `destroy()` removes listeners, cancels RAF, closes audio context |
| `RULE-MRD-001` | `mraid-bridge.js` `init()` state probe + `ready` listener |
| `RULE-MRD-002` | 500 ms watchdog → standalone mode |
| `RULE-MRD-003` | `onPause()` mutes audio and cancels the RAF |
| `RULE-MRD-004` | `onResume()` restores both |
| `RULE-MRD-005` | `openClickthrough()` prefers `mraid.open` |
| `RULE-MRD-006` | Falls back to `window.open(url, '_blank')` |
| `RULE-MRD-007` | Zero `window.parent` references in source |

---

## 4. QA gate definition

`tools/qa.mjs` runs the built artefact in headless Chromium and asserts all 25 checks.
Static checks read the artefact bytes; runtime checks drive the page.

| Check | Mode | Measurement |
| :--- | :--- | :--- |
| `CHK-CVR-01` | runtime | Runner in motion and first destination gate crossed within 5000 ms |
| `CHK-CVR-02` | runtime | Idle hint opacity > 0 by 1500 ms with no input |
| `CHK-CVR-03` | runtime | Funnel state is `ENDCARD` at the 30 s cap |
| `CHK-CVR-04` | runtime | CTA `getBoundingClientRect()` ≥ 44 × 44 |
| `CHK-CVR-05` | runtime | 8 synthetic taps in 200 ms yield exactly 1 clickthrough |
| `CHK-CFG-01` | static | No user-facing literal in engine source regions |
| `CHK-CFG-02` | runtime | Mutating `legalDisclaimer` re-renders the legal node |
| `CHK-CFG-03` | runtime | `?lang=ja` renders the Japanese dictionary |
| `CHK-CFG-04` | runtime | `?lang=xx` renders English |
| `CHK-CFG-05` | runtime | No text node overflows its container in any locale |
| `CHK-CMP-01` | static | Palette equals `brand-tokens.json`; Modern Era present; no dated promo |
| `CHK-CMP-02` | runtime | Computed legal font size ≥ 10px |
| `CHK-CMP-03` | runtime | Computed contrast ratio ≥ 4.5:1 |
| `CHK-CMP-04` | static | No simulated OS alert markup |
| `CHK-CMP-05` | static | No close-button glyph or asset |
| `CHK-PRF-01` | static | Zero external URLs in loadable positions |
| `CHK-PRF-02` | static | Bytes ≤ 2 097 152 |
| `CHK-PRF-03` | static | Every inlined raster ≤ 1024 px |
| `CHK-PRF-04` | runtime | Mean FPS ≥ 50 over a sampled gameplay window |
| `CHK-PRF-05` | runtime | Portrait and landscape both compose without clipping |
| `CHK-MRD-01` | runtime | Mock MRAID records `ready`/`viewableChange`/`stateChange` bindings |
| `CHK-MRD-02` | runtime | `viewableChange:false` ⇒ audio muted and loop paused |
| `CHK-MRD-03` | runtime | `viewableChange:true` ⇒ both resumed |
| `CHK-MRD-04` | runtime | CTA tap calls `mraid.open` with the configured URL |
| `CHK-MRD-05` | runtime | No-MRAID run reaches gameplay and routes via `window.open` |

---

## 5. Running it

```bash
node tools/extract-assets.mjs   # S4 — sprites + font subset + manifest
node tools/build.mjs            # S7 — single-file inline bundle
node tools/qa.mjs               # S8 — 25-check gate, non-zero exit on failure
```

---

## 6. Asset provenance and licensing

Brand marks, the Modern Era typeface, and the sticker illustrations are Holafly property,
harvested from Holafly's own published store listing and web properties. They are used here to
advertise Holafly. This workflow carries no redistribution licence for those assets: reusing this
artefact's `assets/` tree for any other advertiser is a `RULE-CMP-001` violation and a trademark
exposure. Before a third-party ad network flight, confirm the Modern Era licence covers webfont
embedding in served creative.
