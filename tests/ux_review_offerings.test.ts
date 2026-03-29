import test from "node:test";
import assert from "node:assert/strict";

test("ux review offerings can be loaded for the ux-review-orchestrator agent", async () => {
  const offerings = await import("../src/seller/runtime/offerings.js");

  const lite = await offerings.loadOffering("product_ux_gate_lite_v1", "ux-review-orchestrator");
  const deep = await offerings.loadOffering("product_ux_review_deep_v1", "ux-review-orchestrator");

  assert.equal(lite.config.name, "product_ux_gate_lite_v1");
  assert.equal(lite.config.jobFee, 0.02);
  assert.equal(deep.config.name, "product_ux_review_deep_v1");
  assert.equal(deep.config.jobFee, 0.08);
});

test("ux review offering handlers return the expected structured deliverables", async () => {
  const liteHandlers =
    await import("../src/seller/offerings/ux-review-orchestrator/product_ux_gate_lite_v1/handlers.ts");
  const deepHandlers =
    await import("../src/seller/offerings/ux-review-orchestrator/product_ux_review_deep_v1/handlers.ts");

  const liteRequest = {
    url: "https://example.com/signup",
    focus: "onboarding gate",
  };
  const deepRequest = {
    url: "https://example.com/checkout",
    focus: "checkout conversion",
  };

  assert.deepEqual(liteHandlers.validateRequirements(liteRequest), { valid: true });
  assert.deepEqual(deepHandlers.validateRequirements(deepRequest), { valid: true });

  const liteResult = await liteHandlers.executeJob(liteRequest);
  const deepResult = await deepHandlers.executeJob(deepRequest);

  assert.equal(typeof liteResult.deliverable, "object");
  assert.equal(typeof deepResult.deliverable, "object");

  const liteDeliverable = liteResult.deliverable as {
    type: string;
    value: Record<string, unknown>;
  };
  const deepDeliverable = deepResult.deliverable as {
    type: string;
    value: Record<string, unknown>;
  };

  assert.equal(liteDeliverable.type, "json");
  assert.equal(liteDeliverable.value.service, "ux-review-orchestrator");
  assert.equal(liteDeliverable.value.offering, "product_ux_gate_lite_v1");
  assert.equal(liteDeliverable.value.tier, "lite");
  assert.equal(liteDeliverable.value.gateVerdict, "revise");
  assert.ok(Array.isArray(liteDeliverable.value.p0));

  assert.equal(deepDeliverable.type, "json");
  assert.equal(deepDeliverable.value.service, "ux-review-orchestrator");
  assert.equal(deepDeliverable.value.offering, "product_ux_review_deep_v1");
  assert.equal(deepDeliverable.value.tier, "deep");
  assert.ok(Array.isArray(deepDeliverable.value.flowMap));
  assert.ok(typeof deepDeliverable.value.statePolicies === "object");
});
