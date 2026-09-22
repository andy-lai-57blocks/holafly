# SKILL 3: Brand Safety & Legal Compliance Auditor (`playable-brand-and-compliance`)

## 1. Metadata & Scope
* **Skill Name**: `playable-brand-and-compliance`
* **Category**: Content Governance & Regulatory Audit
* **Version**: 2.0.0 (Clean Standard Edition - No Tre Dependency)
* **Domain Target**: Global Ad Policy & Brand Guidelines Compliance

---

## 2. Core Purpose
Ensures ad creatives strictly align with client brand identity standards, regional advertising regulations (COPPA, GDPR, IAP notices), and app store compliance policies. Prevents the deployment of outdated campaign assets, trademark infringements, or manipulative "dark patterns".

---

## 3. Mandatory Rules & Constraints

### 3.1 Brand Identity & Asset Freshness
* **[RULE-CMP-001] Strict Brand Guideline Adherence**: Color palettes, typography, app icons, and logo assets MUST strictly match official brand guidelines.
* **[RULE-CMP-002] Elimination of Outdated Assets**: Ads MUST NOT contain expired promotional offers, deprecated product features, or outdated seasonal campaign themes (e.g., Christmas banners in summer).

### 3.2 Legal Disclaimers & Regulatory Transparency
* **[RULE-CMP-003] Disclaimer Legibility**: Legal disclaimers and terms MUST meet a minimum font size of **10px** and achieve a contrast ratio of at least **4.5:1** against the background (WCAG AA standard).
* **[RULE-CMP-004] Age Ratings & In-App Purchase Disclosures**: Products with age-restricted content or microtransactions MUST include standard disclosure notices (e.g., "Contains In-App Purchases", "18+ Only").
* **[RULE-CMP-005] Child Privacy Safeguards (COPPA / GDPR-K)**: For child-directed applications, tracking pixels, persistent device identifiers, and behavioural profiling scripts are strictly forbidden.

### 3.3 Prohibition of Deceptive Design (Dark Patterns)
* **[RULE-CMP-006] No Fake System Dialogs**: Creative assets MUST NOT simulate mobile OS alerts, low-battery popups, system error dialogs, or incoming call UI.
* **[RULE-CMP-007] No Fake Close/Dismiss Buttons**: Ad graphics MUST NOT include static or misleading "X" / close buttons intended to trick users into tapping the creative.

---

## 4. Compliance Audit Rule Matrix

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ComplianceAuditMatrix",
  "type": "object",
  "properties": {
    "disclaimerMinFontSizePx": { "type": "integer", "default": 10 },
    "contrastRatioMin": { "type": "number", "default": 4.5 },
    "forbiddenUIElements": {
      "type": "array",
      "items": { "type": "string" },
      "default": ["fake_x_button", "fake_system_alert", "fake_battery_warning", "fake_missed_call"]
    },
    "coppaComplianceRequired": { "type": "boolean", "default": false }
  }
}
```

---

## 5. QA Verification Checklist (`CHK-CMP`)

| Check ID | Verification Description | Requirement | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| **CHK-CMP-01** | Brand guidelines & fresh assets | `[RULE-CMP-001/002]` | **Pass**: Logo & colors match brand guide; no expired promos. |
| **CHK-CMP-02** | Legal disclaimer font size $\ge 10\text{px}$ | `[RULE-CMP-003]` | **Pass**: Measured text font size is at least 10px. |
| **CHK-CMP-03** | WCAG AA Contrast Ratio $\ge 4.5:1$ | `[RULE-CMP-003]` | **Pass**: Text vs background contrast meets 4.5:1 threshold. |
| **CHK-CMP-04** | No fake system dialogs or alerts | `[RULE-CMP-006]` | **Pass**: Creative contains zero simulated OS popups. |
| **CHK-CMP-05** | No deceptive close buttons | `[RULE-CMP-007]` | **Pass**: No hardcoded static "X" images in HTML payload. |
