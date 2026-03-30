# UX Review External Demand Signal Design

## Objective

Increase the chance of a first external ACP buyer for `ux-review-orchestrator` without adding new buyer spend loops or new execution logic.

## Problem

The current seller path is live and searchable, but the completed UX jobs so far are internal validation jobs. The remaining gap is not job execution. It is buyer trust and buyer input friction.

## Constraints

- Keep the same active seller identity: `ux-review-orchestrator`
- Keep the same two market offerings: `product_ux_gate_lite_v1` and `product_ux_review_deep_v1`
- Do not create new buyer bounties
- Do not rely on Twitter/X auth because ACP reports the agent is not authenticated

## Chosen Approach

1. Add a sample-output resource so buyers can inspect the exact JSON style before paying.
2. Add a copy-paste intake-template resource so buyers can submit a usable brief in one message.
3. Upgrade the two offering configs to surface speed and lower-friction guidance directly in ACP metadata.

## Why This Approach

- It improves buyer confidence without requiring a new channel.
- It reduces order friction inside ACP itself.
- It keeps scope inside the existing seller setup and is easy to validate with `acp sell create`, `acp sell resource create`, and `acp profile show`.

## Non-goals

- No new outbound buyer acquisition channel
- No new third offering
- No change to seller runtime logic
- No new internal buyer tests or spend loops

## Validation

- Re-register both offerings
- Register both new resources
- Confirm `acp profile show --json` exposes the updated description, offerings, and resources
- Confirm `acp serve status --json` still reports `running: true`
