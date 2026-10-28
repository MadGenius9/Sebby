import test from "node:test";
import assert from "node:assert/strict";
import { ReminderNotificationController } from "../electron/notifications.mjs";
function fixture(options = {}) {
  let now = 1000;
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`,
    title: `Reminder ${i}`,
    dueAt: 1000,
    status: "scheduled",
  }));
  const shown = [];
  const reminders = {
    due: () => items.filter((x) => x.status === "scheduled" && x.dueAt <= now),
    markDelivered: async (id) => {
      items.find((x) => x.id === id).status = "delivered";
    },
  };
  const controller = new ReminderNotificationController({
    reminders,
    approve: async () => true,
    supported: () => true,
    deliver: async (item) => shown.push(item.id),
    now: () => now,
    ...options,
  });
  return { controller, items, shown, advance: (value) => (now = value) };
}
test("notifications require explicit consent, are session only and limit each tick to three", async () => {
  const { controller, shown } = fixture();
  await controller.tick();
  assert.equal(shown.length, 0);
  await controller.enable();
  await controller.tick();
  assert.equal(shown.length, 3);
  assert.equal(controller.status().enabled, true);
  controller.disable();
  await controller.tick();
  assert.equal(shown.length, 3);
  const next = fixture();
  assert.equal(next.controller.status().enabled, false);
});
test("unsupported/denied notifications never call delivery", async () => {
  for (const options of [
    { supported: () => false },
    { approve: async () => false },
  ]) {
    const { controller, shown } = fixture(options);
    await controller.enable();
    await controller.tick();
    assert.equal(shown.length, 0);
    assert.equal(controller.status().enabled, false);
  }
});
test("failure leaves reminders scheduled and enforces five-minute per-id backoff", async () => {
  const attempted = [];
  const { controller, items, advance } = fixture({
    deliver: async ({ id }) => {
      attempted.push(id);
      throw Error("secret adapter details");
    },
  });
  await controller.enable();
  await controller.tick();
  assert.equal(items[0].status, "scheduled");
  await controller.tick();
  assert.deepEqual(attempted, ["r0", "r1", "r2", "r3", "r4"]);
  await controller.tick();
  assert.equal(attempted.length, 5);
  advance(301000);
  await controller.tick();
  assert.equal(attempted.length, 8);
  assert.equal(controller.status().lastError.includes("secret"), false);
});
test("pending delivery is not marked delivered; disable aborts without starting another", async () => {
  let started;
  const start = new Promise((resolve) => (started = resolve));
  let calls = 0;
  const { controller, items } = fixture({
    deliver: ({ signal }) => {
      calls++;
      started();
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("abort")), {
          once: true,
        }),
      );
    },
  });
  await controller.enable();
  const pending = controller.tick();
  await start;
  assert.equal(items[0].status, "scheduled");
  await controller.tick();
  assert.equal(calls, 1);
  controller.disable();
  await pending;
  assert.equal(items[0].status, "scheduled");
  assert.equal(calls, 1);
  assert.equal(controller.status().busy, false);
});
test("shutdown while approval is pending cannot reenable notifications", async () => {
  let resolve;
  const { controller } = fixture({
    approve: () => new Promise((r) => (resolve = r)),
  });
  const pending = controller.enable();
  controller.shutdown();
  resolve(true);
  await pending;
  assert.equal(controller.status().enabled, false);
  await assert.rejects(controller.enable(), /shutting down/);
});
test("timeout rejects unresponsive adapter and retains pending reminder", async () => {
  const { controller, items } = fixture({
    deliveryTimeoutMs: 10,
    deliver: () => new Promise(() => {}),
  });
  await controller.enable();
  await controller.tick();
  assert.equal(items[0].status, "scheduled");
  assert.match(controller.status().lastError, /five minutes/);
});
test("confirmation as displayed marks delivered and shutdown blocks later ticks", async () => {
  const { controller, items, shown } = fixture();
  await controller.enable();
  await controller.tick();
  assert.equal(items[0].status, "delivered");
  controller.shutdown();
  await controller.tick();
  assert.equal(shown.length, 3);
});
