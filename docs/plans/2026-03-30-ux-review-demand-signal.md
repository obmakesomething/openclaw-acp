# UX Review External Demand Signal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve external buyer conversion for `ux-review-orchestrator` by adding proof, adding a submission template, and tightening offering metadata.

**Architecture:** Keep the existing two UX offerings and seller runtime intact. Improve the ACP-facing layer only: docs-backed resources plus offering metadata and profile copy that make ordering easier for external buyers.

**Tech Stack:** TypeScript ACP CLI repo, JSON offering/resource definitions, Markdown proof docs

---

### Task 1: Add buyer proof documents

**Files:**
- Create: `docs/ux-review-sample-output.md`
- Create: `docs/ux-review-intake-template.md`

**Step 1: Write the buyer-facing sample output doc**

Include one lite JSON example and one deep JSON example that match the existing UX response shapes.

**Step 2: Write the buyer-facing intake template doc**

Include a short copy-paste template for lite and deep requests with the highest-signal fields.

### Task 2: Register new ACP resources

**Files:**
- Create: `src/seller/resources/ux_review_sample_output/resources.json`
- Create: `src/seller/resources/ux_review_intake_template/resources.json`

**Step 1: Point each resource to the raw GitHub URL for its new doc**

Keep the descriptions explicit so buyers know what each resource is for.

### Task 3: Tighten offering metadata for conversion

**Files:**
- Modify: `src/seller/offerings/ux-review-orchestrator/product_ux_gate_lite_v1/offering.json`
- Modify: `src/seller/offerings/ux-review-orchestrator/product_ux_review_deep_v1/offering.json`
- Modify: `docs/ux-review-proof-pack.md`

**Step 1: Update descriptions**

Mention speed, structured JSON, and the ACP resources for sample output and intake template.

**Step 2: Add explicit SLA metadata**

Set `slaMinutes` to a clear value for lite and deep offers.

**Step 3: Reduce form friction**

Add example-rich field descriptions and lightweight defaults where useful.

### Task 4: Re-register and verify ACP state

**Files:**
- No new files

**Step 1: Re-register offerings**

Run `npx tsx bin/acp.ts sell create product_ux_gate_lite_v1`

Run `npx tsx bin/acp.ts sell create product_ux_review_deep_v1`

**Step 2: Register new resources**

Run `npx tsx bin/acp.ts sell resource create ux_review_sample_output`

Run `npx tsx bin/acp.ts sell resource create ux_review_intake_template`

**Step 3: Refresh profile copy**

Update the profile description so it points buyers to the two new resources.

**Step 4: Verify**

Run:

```bash
npx tsx bin/acp.ts profile show --json
npx tsx bin/acp.ts sell resource list --json
npx tsx bin/acp.ts serve status --json
```
