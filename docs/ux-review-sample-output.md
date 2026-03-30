# UX Review Sample Output

These are anonymized example outputs that match the live JSON shapes used by `ux-review-orchestrator`.

## Lite sample

```json
{
  "gateVerdict": "revise",
  "decision": "Do not ship the current onboarding entry screen as-is.",
  "primaryAction": "Reduce the first screen to one core action and move plan comparison behind the first successful step.",
  "secondaryActions": [
    "Replace the 6-card choice wall with one recommended default path.",
    "Add a short trust line directly under the primary CTA.",
    "Delay optional profile fields until after account creation."
  ],
  "p0": [
    "Too many competing actions before the user understands the next step.",
    "Headline promises speed but the screen asks for commitment-heavy decisions.",
    "No clear reassurance about reversibility or data usage."
  ],
  "fastFixes": [
    "Change the CTA label from 'Continue' to 'Start 2-minute setup'.",
    "Collapse secondary plans into a 'Compare options' link.",
    "Add one sentence clarifying what happens after the first click."
  ],
  "missingEvidence": [
    "No mobile screenshots were provided.",
    "No current drop-off metric was supplied."
  ],
  "assumptions": [
    "The primary business goal is successful first-session activation.",
    "The target user is evaluating the product for the first time."
  ]
}
```

## Deep sample

```json
{
  "summary": "The checkout flow is structurally close, but it asks for too many commitments before reinforcing price clarity and shipping confidence. The main conversion risk is state ambiguity between cart review, shipping selection, and payment confirmation.",
  "flowMap": [
    {
      "step": "Cart review",
      "risk": "medium",
      "note": "Users see discounts, shipping teaser text, and coupon entry at the same time."
    },
    {
      "step": "Shipping method",
      "risk": "high",
      "note": "Delivery speed and final cost are split across two different visual groups."
    },
    {
      "step": "Payment confirmation",
      "risk": "high",
      "note": "The final CTA appears before refund and change-summary cues are easy to scan."
    }
  ],
  "priorityIssues": [
    {
      "severity": "P0",
      "issue": "Shipping cost certainty arrives too late.",
      "whyItMatters": "Users cannot confidently compare the total before committing."
    },
    {
      "severity": "P1",
      "issue": "Discount logic competes with primary completion cues.",
      "whyItMatters": "Coupon exploration steals attention from the purchase path."
    },
    {
      "severity": "P1",
      "issue": "The confirmation step hides editability signals.",
      "whyItMatters": "Users hesitate when they think mistakes are irreversible."
    }
  ],
  "iaRecommendation": "Re-group the flow into three explicit sections: Order, Delivery, Payment. Keep price updates pinned at the section boundary instead of burying them inside cards.",
  "top3Flows": [
    "First-time purchase with standard shipping",
    "Coupon-aware repeat purchase",
    "Urgent purchase with fast shipping"
  ],
  "statePolicies": [
    "Always show updated total immediately after shipping changes.",
    "Treat coupon errors as inline recoverable states, not global alerts.",
    "Keep edit links visible on the final review state."
  ],
  "experimentPlan": [
    "Test a pinned order summary versus the current stacked layout.",
    "Move coupon entry below payment selection for first-time users.",
    "Add a delivery-confidence row with refund and editability cues."
  ],
  "missingEvidence": [
    "No variant for guest checkout was provided.",
    "No funnel step metrics were attached."
  ],
  "assumptions": [
    "Checkout completion is the primary KPI.",
    "The team can change layout grouping within the current sprint."
  ]
}
```
