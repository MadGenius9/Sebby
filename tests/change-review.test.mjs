import test from "node:test";
import assert from "node:assert/strict";
import { ChangeReviewGate } from "../electron/change-review.mjs";
const request = {
  kind: "apply-edit",
  path: "app.ts",
  workspace: "/chosen",
  operation: "edit",
  afterHash: "abc",
  diff: {
    text: "-old\n+new",
    truncated: false,
    removedLines: 1,
    addedLines: 1,
  },
};
test("full diff is main owned; acknowledgement only resolves review with matching nonce", async () => {
  const gate = new ChangeReviewGate();
  const promise = gate.request(request);
  const view = gate.list();
  view.diff = "forged";
  assert.equal(gate.list().diff, "-old\n+new");
  assert.throws(() => gate.respond({ id: "wrong", accepted: true }));
  gate.respond({ id: view.id, accepted: true });
  assert.equal(await promise, true);
  assert.equal(gate.list(), null);
});
test("cancellation and shutdown never approve pending changes", async () => {
  const gate = new ChangeReviewGate(),
    controller = new AbortController();
  const pending = gate.request(request, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, false);
  const next = gate.request(request);
  gate.shutdown();
  assert.equal(await next, false);
  assert.equal(await gate.request(request), false);
});
test("truncated/missing review and concurrent request are refused", async () => {
  const gate = new ChangeReviewGate();
  assert.throws(() =>
    gate.request({ ...request, diff: { ...request.diff, truncated: true } }),
  );
  const pending = gate.request(request);
  assert.throws(() => gate.request(request));
  gate.shutdown();
  assert.equal(await pending, false);
});
