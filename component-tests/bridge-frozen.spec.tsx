import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  delete window.sebby;
  vi.resetModules();
});

test("busy wrapper supports Electron's frozen contextBridge API and drains on errors", async () => {
  window.sebby = Object.freeze({
    getState: vi.fn(async () => {
      throw new Error("fixture failure");
    }),
  }) as unknown as NonNullable<Window["sebby"]>;
  const { bridge, isBusy } = await import("../src/bridge");
  const pending = bridge.getState();
  expect(isBusy()).toBe(true);
  await expect(pending).rejects.toThrow("fixture failure");
  expect(isBusy()).toBe(false);
});
