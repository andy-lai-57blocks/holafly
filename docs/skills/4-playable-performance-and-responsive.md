# SKILL 4: Lightweight & Responsive Performance Engineer (`playable-performance-and-responsive`)

## 1. Metadata & Scope
* **Skill Name**: `playable-performance-and-responsive`
* **Category**: Bundle Optimization & Responsive Layout Engineering
* **Version**: 2.0.0 (Clean Standard Edition - No Tre Dependency)
* **Domain Target**: High-Performance Mobile WebGL/Canvas Ad Packaging

---

## 2. Core Purpose
Guarantees lightning-fast loading, smooth 50+ FPS animation, responsive layout adaptability across all device aspect ratios and notch safe areas, and strict adherence to network bundle budgets.

---

## 3. Mandatory Rules & Constraints

### 3.1 Single Inline HTML Packaging & File Budgets
* **[RULE-PRF-001] Self-Contained Bundle**: The complete playable ad MUST be packaged into a **single, standalone `.html` file** with all CSS, JS, textures (Base64 WebP/SVG), and audio inlined. Zero external runtime CDN or HTTP requests are allowed.
* **[RULE-PRF-002] Total File Size Budget**:
  - Target Budget: **$\le 2\text{ MB}$** (compressed/uncompressed standard).
  - Hard Maximum Cap: **$\le 5\text{ MB}$** (high-tier networks).
* **[RULE-PRF-003] Initial Payload Limit**: Non-JS initial bootstrap resources MUST NOT exceed **200 KB**.

### 3.2 Asset & Texture Optimization
* **[RULE-PRF-004] Maximum Texture Resolution**: Individual image assets MUST NOT exceed **1024x1024 pixels**.
* **[RULE-PRF-005] Modern Image Formats**: Images MUST use WebP or SVG vector format for optimal compression.
* **[RULE-PRF-006] Audio Bitrate Constraints**: Audio tracks MUST be compressed to mono MP3/AAC at **32-48 kbps**, with a maximum total audio file footprint under **150 KB**.

### 3.3 Responsive Layout & Safe Area Adaptation
* **[RULE-PRF-007] Dynamic Orientation Handling**: Layout MUST adapt dynamically to both Portrait (9:16) and Landscape (16:9 / 4:3) mode changes without clipping key UI, text, or interactive game targets.
* **[RULE-PRF-008] Notch & Safe Area Insets**: Layout CSS MUST use CSS safe area variables (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) to prevent notch or hardware camera cutout overlap.

### 3.4 Runtime Frame Rate & Memory Constraints
* **[RULE-PRF-009] Frame Rate Target**: Game loop MUST maintain an average frame rate of **$\ge 50\text{ FPS}$** on mid-tier mobile hardware.
* **[RULE-PRF-010] First Contentful Paint (FCP)**: FCP duration MUST be under **800ms**.
* **[RULE-PRF-011] Zero Memory Leaks**: Canvas objects, WebGL textures, and event listeners MUST be destroyed/cleared upon ad teardown.

---

## 4. Responsive & Safe Area CSS Template

```css
/* Responsive Viewport & Safe Area Base Boilerplate */
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  user-select: none;
  touch-action: manipulation;
  -webkit-touch-callout: none;
}

#playable-root {
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;

  /* Hardware Safe-Area Padding */
  padding-top: max(12px, env(safe-area-inset-top));
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  padding-left: max(8px, env(safe-area-inset-left));
  padding-right: max(8px, env(safe-area-inset-right));

  box-sizing: border-box;
}

/* Aspect Ratio Auto-Scaling Container */
#game-canvas-container {
  flex: 1;
  width: 100%;
  height: 100%;
  position: relative;
}

canvas {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
}
```

---

## 5. QA Verification Checklist (`CHK-PRF`)

| Check ID | Verification Description | Requirement | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| **CHK-PRF-01** | Single inline `.html` (0 external requests) | `[RULE-PRF-001]` | **Pass**: HTML contains zero `<script src="http...">` or external links. |
| **CHK-PRF-02** | Total file size $\le 2\text{MB}$ | `[RULE-PRF-002]` | **Pass**: Total single file footprint is $\le 2,097,152$ bytes. |
| **CHK-PRF-03** | Max texture size $\le 1024\text{px}$ | `[RULE-PRF-004]` | **Pass**: All inline image dimensions $\le 1024\text{px}$. |
| **CHK-PRF-04** | Average frame rate $\ge 50\text{ FPS}$ | `[RULE-PRF-009]` | **Pass**: FPS counter maintains $\ge 50$ during gameplay session. |
| **CHK-PRF-05** | Portrait & Landscape dynamic resize | `[RULE-PRF-007]` | **Pass**: Rotating device updates viewport layout without UI breaks. |
