import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { previewWindowAdapter } from "../electron/preview-window.mjs";
import { previewDocument } from "../electron/preview.mjs";
function fixture({ stallCommand = false, stallLoad = false } = {}) {
  const seen = { loads: 0, shown: 0, closed: 0 };
  const isolated = new EventEmitter();
  Object.assign(isolated, {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    setDevicePermissionHandler() {},
    webRequest: { onBeforeRequest() {} },
    protocol: {
      handle() {},
      unhandle() {
        seen.unhandled = true;
      },
    },
    clearStorageData: async () => {},
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      seen.window = this;
      seen.options = options;
      this.dead = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        setWindowOpenHandler() {},
        debugger: new EventEmitter(),
      });
      Object.assign(this.webContents.debugger, {
        attach() {},
        sendCommand: async () => {
          if (stallCommand) return new Promise(() => {});
        },
      });
    }
    isDestroyed() {
      return this.dead;
    }
    destroy() {
      if (this.dead) return;
      this.dead = true;
      this.emit("closed");
    }
    setMenu() {}
    loadURL() {
      seen.loads++;
      return stallLoad ? new Promise(() => {}) : Promise.resolve();
    }
    show() {
      seen.shown++;
    }
  }
  return {
    seen,
    adapter: previewWindowAdapter({
      BrowserWindow: Window,
      session: { fromPartition: () => isolated },
    }),
  };
}
const request = (signal) => ({
  id: "12345678-1234-1234-1234-123456789abc",
  url: previewDocument("<h1>Untrusted fixture</h1>"),
  signal,
});
async function settles(promise) {
  let timeout;
  try {
    return await Promise.race([
      promise.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise(
        (resolve) => (timeout = setTimeout(() => resolve("hung"), 200)),
      ),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
test("abort while required browser guard stalls destroys preview and settles without loading", async () => {
  const f = fixture({ stallCommand: true }),
    controller = new AbortController();
  const pending = f.adapter.openWindow({
    ...request(controller.signal),
    onClosed: () => f.seen.closed++,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal(await settles(pending), "rejected");
  assert.equal(f.seen.window.dead, true);
  assert.equal(f.seen.loads, 0);
  assert.equal(f.seen.shown, 0);
  assert.equal(f.seen.closed, 1);
});
test("closing during stalled initial document load settles and never shows dead window", async () => {
  const f = fixture({ stallLoad: true });
  const pending = f.adapter.openWindow({
    ...request(new AbortController().signal),
    onClosed: () => f.seen.closed++,
  });
  await new Promise((resolve) => setImmediate(resolve));
  f.seen.window.destroy();
  assert.equal(await settles(pending), "rejected");
  assert.equal(f.seen.shown, 0);
  assert.equal(f.seen.closed, 1);
});
