import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { previewWindowAdapter } from "../electron/preview-window.mjs";
import { previewDocument } from "../electron/preview.mjs";
function fixture({ failGuard = false } = {}) {
  const observed = { commands: [], loads: [] };
  const isolated = new EventEmitter();
  Object.assign(isolated, {
    setPermissionRequestHandler: (fn) => (observed.permissions = fn),
    setPermissionCheckHandler: (fn) => (observed.check = fn),
    setDevicePermissionHandler: (fn) => (observed.device = fn),
    webRequest: { onBeforeRequest: (fn) => (observed.requests = fn) },
    protocol: {
      handle: (scheme, handler) => {
        observed.scheme = scheme;
        observed.handler = handler;
      },
      unhandle: () => {
        observed.unhandled = true;
      },
    },
    clearStorageData: async () => {},
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      observed.options = options;
      observed.window = this;
      this.dead = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        setWindowOpenHandler: (fn) => (observed.popups = fn),
        debugger: new EventEmitter(),
      });
      Object.assign(this.webContents.debugger, {
        attach: (version) => (observed.debugger = version),
        sendCommand: async (name, args) => {
          observed.commands.push([name, args]);
          if (failGuard && name === "Page.setInterceptFileChooserDialog")
            throw Error("unsupported");
        },
      });
    }
    setMenu(value) {
      observed.menu = value;
    }
    isDestroyed() {
      return this.dead;
    }
    destroy() {
      this.dead = true;
      this.emit("closed");
    }
    async loadURL(url) {
      observed.loads.push(url);
    }
    show() {
      observed.shown = true;
    }
  }
  const adapter = previewWindowAdapter({
    BrowserWindow: Window,
    session: {
      fromPartition: (name, options) => {
        observed.partition = name;
        observed.partitionOptions = options;
        return isolated;
      },
    },
  });
  return { adapter, observed, isolated };
}
const input = () => ({
  id: "12345678-1234-1234-1234-123456789abc",
  url: previewDocument("<h1>Fixture</h1>"),
  signal: new AbortController().signal,
});
test("preview uses isolated ephemeral session, no preload or Node and response sandbox before load", async () => {
  const f = fixture();
  let closed = 0;
  await f.adapter.openWindow({ ...input(), onClosed: () => closed++ });
  const o = f.observed,
    p = o.options.webPreferences;
  assert.equal(p.nodeIntegration, false);
  assert.equal(p.sandbox, true);
  assert.equal(p.contextIsolation, true);
  assert.equal(p.preload, undefined);
  assert.equal(p.devTools, false);
  assert.equal(p.disableDialogs, true);
  assert.equal(p.javascript, false);
  assert.equal(o.partition.startsWith("persist:"), false);
  assert.equal(o.partitionOptions.cache, false);
  assert.deepEqual(o.popups(), { action: "deny" });
  assert.equal(o.check(), false);
  assert.equal(o.device(), false);
  o.permissions(null, "media", (x) => assert.equal(x, false));
  assert.equal(o.commands[1][0], "Page.setInterceptFileChooserDialog");
  assert.deepEqual(o.commands[1][1], { enabled: true, cancel: true });
  const response = await o.handler({ url: o.loads[0], method: "GET" });
  assert.match(response.headers.get("Content-Security-Policy"), /sandbox$/);
  assert.match(
    response.headers.get("Content-Security-Policy"),
    /connect-src 'none'/,
  );
  assert.equal(
    (await o.handler({ url: "https://other.test", method: "GET" })).status,
    403,
  );
  assert.equal(
    (await o.handler({ url: o.loads[0], method: "POST" })).status,
    403,
  );
  for (const url of [
    "file:///private",
    "https://other.test",
    "http://127.0.0.1:8000",
    "https://api.openai.com",
    "ws://localhost",
  ])
    o.requests({ url }, (r) => assert.equal(r.cancel, true));
  o.requests({ url: o.loads[0] }, (r) => assert.equal(r.cancel, false));
  assert.equal(o.shown, true);
  await f.adapter.closeWindow(o.window);
  assert.equal(closed, 1);
  assert.equal(o.unhandled, true);
});
test("required file chooser guard failure never loads or shows untrusted source", async () => {
  const f = fixture({ failGuard: true });
  await assert.rejects(
    f.adapter.openWindow(input()),
    /Required browser guards/,
  );
  assert.equal(f.observed.loads.length, 0);
  assert.equal(f.observed.shown, undefined);
  assert.equal(f.observed.window.dead, true);
});
test("abort, debugger detach, navigation, downloads and Escape have explicit deny or close controls", async () => {
  const f = fixture();
  const controller = new AbortController();
  await f.adapter.openWindow({ ...input(), signal: controller.signal });
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  for (const name of [
    "will-navigate",
    "will-frame-navigate",
    "will-redirect",
    "will-attach-webview",
    "will-prevent-unload",
  ])
    f.observed.window.webContents.emit(name, event);
  f.isolated.emit("will-download", event);
  assert.equal(prevented, 6);
  controller.abort();
  assert.equal(f.observed.window.dead, true);
  const second = fixture();
  await second.adapter.openWindow(input());
  second.observed.window.webContents.debugger.emit("detach");
  assert.equal(second.observed.window.dead, true);
  const third = fixture();
  await third.adapter.openWindow(input());
  third.observed.window.webContents.emit("before-input-event", event, {
    key: "Escape",
  });
  assert.equal(third.observed.window.dead, true);
});
