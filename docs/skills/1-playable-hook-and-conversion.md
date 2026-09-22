# SKILL 1: Playable Hook & CTA Conversion Engine (`playable-hook-and-conversion`)

## 1. Metadata & Scope
* **Skill Name**: `playable-hook-and-conversion`
* **Category**: Creative & Conversion Architecture
* **Version**: 2.0.0 (Clean Standard Edition - No Tre Dependency)
* **Domain Target**: Mobile In-App Playable Ads (HTML5 / Mobile SDKs)

---

## 2. Core Purpose
Enforces authentic gameplay mechanics, instant visual affordances, high-converting call-to-action (CTA) funnels, and auto-resolution transitions within interactive ad creatives. Ensures maximum user engagement while eliminating misleading "fake ad" practices.

---

## 3. Mandatory Rules & Constraints

### 3.1 Authentic Product Hook (True-to-Product)
* **[RULE-CVR-001] First 3-5 Seconds Value Proposition**: The initial 3 to 5 seconds of the playable ad MUST showcase core gameplay mechanics, authentic product USPs, or real app features.
* **[RULE-CVR-002] Anti-Fake-Ad Policy**: Mini-games or interactive puzzles must represent actual features or mini-games present within the advertised application. Deceptive "pull-the-pin" or fake fail mechanics for unrelated apps are strictly prohibited.

### 3.2 Interaction Affordances & Idle System
* **[RULE-CVR-003] Immediate Visual Hint**: If the user does not interact within **1.5 seconds** of launch, the ad MUST trigger a subtle visual hint (e.g., bouncing hand/finger icon, flashing arrow, or pulsing interaction target).
* **[RULE-CVR-004] Non-Intrusive Guidance**: Idle prompts must auto-dismiss instantly upon the user's first touch (`touchstart` / `mousedown`).

### 3.3 Auto-Resolution & Endcard Transition
* **[RULE-CVR-005] Maximum Interactive Loop**: Interactive gameplay MUST NOT exceed **30 seconds**.
* **[RULE-CVR-006] Auto-Endcard Trigger**: Upon completing gameplay (Win, Loss, or Reaching the 30-second cap), the ad MUST automatically transition smoothly to the final Endcard display.
* **[RULE-CVR-007] Persistent CTA**: A prominent CTA button ("Install Now", "Play Free", "Claim Reward") MUST remain clearly visible on the Endcard and during key interactive states.

### 3.4 Action Debouncing & Touch Targets
* **[RULE-CVR-008] CTA Click Debouncing**: All CTA buttons MUST implement a **1000ms debounce** guard to prevent double-click or accidental spam taps.
* **[RULE-CVR-009] Minimum Touch Target Size**: All interactive buttons and CTA targets MUST maintain a minimum clickable area of **44x44 dp / px** for mobile accessibility.

---

## 4. Playable Gameplay Funnel State Machine

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PlayableFunnelState",
  "type": "object",
  "properties": {
    "currentState": {
      "type": "string",
      "enum": ["INIT", "HOOK_ACTIVE", "IDLE_HINT", "INTERACTIVE_GAMEPLAY", "ENDCARD", "CLICKTHROUGH"]
    },
    "idleTimeoutMs": {
      "type": "integer",
      "default": 1500
    },
    "maxGameplayDurationMs": {
      "type": "integer",
      "default": 30000
    },
    "ctaDebounceMs": {
      "type": "integer",
      "default": 1000
    }
  },
  "required": ["currentState", "idleTimeoutMs", "maxGameplayDurationMs", "ctaDebounceMs"]
}
```

---

## 5. QA Verification Checklist (`CHK-CVR`)

| Check ID | Verification Description | Requirement | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| **CHK-CVR-01** | First 3–5s authentic gameplay hook | `[RULE-CVR-001]` | **Pass**: Shows real app feature in first 5s. |
| **CHK-CVR-02** | Idle hint appears within 1.5s | `[RULE-CVR-003]` | **Pass**: Animated hand/arrow appears if untouched for 1.5s. |
| **CHK-CVR-03** | Max 30s auto-endcard transition | `[RULE-CVR-005]` | **Pass**: Ad automatically switches to Endcard at 30s mark. |
| **CHK-CVR-04** | CTA touch target size $\ge 44\text{px}$ | `[RULE-CVR-009]` | **Pass**: Click target bounds exceed $44 \times 44$ pixels. |
| **CHK-CVR-05** | CTA click debouncing (1000ms) | `[RULE-CVR-008]` | **Pass**: Multiple rapid taps trigger only 1 click event. |
