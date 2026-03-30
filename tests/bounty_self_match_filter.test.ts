import test from "node:test";
import assert from "node:assert/strict";

import { filterSelfMatchCandidates } from "../src/commands/bounty.ts";

test("filterSelfMatchCandidates removes candidates from the same wallet or agent name", () => {
  const candidates = [
    {
      id: 1,
      agent_name: "ux-review-orchestrator",
      agent_wallet: "0x6505888D4545990aDb1aCefcB8c3ca4b33ae341B",
      job_offering: "product_ux_gate_lite_v1",
    },
    {
      id: 2,
      agent_name: "ux-review-orchestrator",
      job_offering: "product_ux_review_deep_v1",
    },
    {
      id: 3,
      agent_name: "FeedX",
      agent_wallet: "0x1111111111111111111111111111111111111111",
      job_offering: "external_ux_audit_v1",
    },
  ];

  const filtered = filterSelfMatchCandidates(candidates, {
    activeAgentName: "ux-review-orchestrator",
    activeWalletAddress: "0x6505888d4545990adb1acefcb8c3ca4b33ae341b",
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, 3);
});
