import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  makeNotificationDelivery,
  installNotifications,
} from "../electron/notification-ipc.mjs";
class FakeNotification extends EventEmitter {
  static instances = [];
  static isSupported() {
    return true;
  }
  constructor(options) {
    super();
    this.options = options;
    this.closed = false;
    FakeNotification.instances.push(this);
  }
  show() {
    this.called = true;
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}
test("native delivery is silent, resolves only actual show and abort closes pending instance", async () => {
  FakeNotification.instances = [];
  const deliver = makeNotificationDelivery(FakeNotification);
  const controller = new AbortController();
  let resolved = false;
  const promise = deliver({
    title: "Reminder text",
    signal: controller.signal,
  }).then(() => {
    resolved = true;
  });
  const notification = FakeNotification.instances[0];
  assert.equal(notification.options.silent, true);
  assert.equal(notification.called, true);
  await Promise.resolve();
  assert.equal(resolved, false);
  notification.emit("show");
  await promise;
  assert.equal(resolved, true);
  assert.equal(notification.listenerCount("show"), 0);
  const cancelled = new AbortController();
  const pending = deliver({ title: "Cancel", signal: cancelled.signal });
  cancelled.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(FakeNotification.instances[1].closed, true);
});
test("native failed and premature close never claim displayed", async () => {
  const deliver = makeNotificationDelivery(FakeNotification);
  const first = deliver({
    title: "Failed",
    signal: new AbortController().signal,
  });
  FakeNotification.instances
    .at(-1)
    .emit("failed", {}, "sensitive native detail");
  await assert.rejects(first, /Native notification failed/);
  const second = deliver({
    title: "Closed",
    signal: new AbortController().signal,
  });
  FakeNotification.instances.at(-1).emit("close");
  await assert.rejects(second, /before display/);
});
test("renderer cannot force notification consent or arbitrary delivery through IPC", async () => {
  const handlers = new Map();
  let confirmations = 0;
  const controller = installNotifications({
    reminders: {
      due: () => [{ id: "a", title: "Saved reminder" }],
      markDelivered: async () => assert.fail("Must not deliver"),
    },
    register: (name, fn) => handlers.set(name, fn),
    confirm: async () => {
      confirmations++;
      return false;
    },
    Notification: FakeNotification,
  });
  const count = FakeNotification.instances.length;
  await handlers.get("enable-notifications")({
    approved: true,
    title: "Injected",
  });
  await controller.tick();
  assert.equal(confirmations, 1);
  assert.equal(controller.status().enabled, false);
  assert.equal(FakeNotification.instances.length, count);
  assert.equal(handlers.has("send-notification"), false);
  controller.shutdown();
});
