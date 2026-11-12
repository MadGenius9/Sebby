import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { allowedResource } from "../electron/resource-policy.mjs";
test("preload exposes fixed operations and strips native event objects from subscriptions", async () => {
  let bridge;
  const calls = [],
    listeners = new Map();
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, value) => {
        assert.equal(name, "sebby");
        bridge = value;
      },
    },
    ipcRenderer: {
      invoke: (...args) => {
        calls.push(args);
        return Promise.resolve({});
      },
      on: (name, fn) => listeners.set(name, fn),
      removeListener: (name, fn) => {
        assert.equal(listeners.get(name), fn);
        listeners.delete(name);
      },
    },
  };
  vm.runInNewContext(
    await fs.readFile(
      new URL("../electron/preload.cjs", import.meta.url),
      "utf8",
    ),
    {
      require: (name) => {
        assert.equal(name, "electron");
        return electron;
      },
    },
  );
  assert.equal(Object.isFrozen(bridge), true);
  for (const key of [
    "invoke",
    "send",
    "getKey",
    "readCredential",
    "eval",
    "exec",
    "shell",
    "require",
  ])
    assert.equal(bridge[key], undefined);
  await bridge.providerStatus();
  await bridge.cancelProviderTest();
  assert.equal(calls[0][0], "sebby:provider-status");
  assert.equal(calls[1][0], "sebby:cancel-provider-test");
  const secretNativeEvent = { sender: "DO_NOT_EXPOSE" };
  let observed;
  const off = bridge.onChatEvent((...args) => (observed = args));
  listeners.get("sebby:chat-event")(secretNativeEvent, { type: "status" });
  assert.deepEqual(observed, [{ type: "status" }]);
  off();
  assert.equal(listeners.has("sebby:chat-event"), false);
  const stop = bridge.onProviderChanged((...args) => (observed = args));
  listeners.get("sebby:provider-changed")(secretNativeEvent, {
    untrusted: "ignored",
  });
  assert.deepEqual(observed, []);
  stop();
});
test("GLB local packaged resource needs no remote or out-of-bundle filesystem permission", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-glb-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  await fs.mkdir(path.join(dist, "pals"), { recursive: true });
  const asset = path.join(dist, "pals", "orbit.glb");
  await fs.writeFile(asset, "fixture");
  assert.equal(await allowedResource(pathToFileURL(asset).href, dist), true);
  assert.equal(
    await allowedResource("https://example.com/model.glb", dist),
    false,
  );
  const outside = path.join(root, "outside.glb");
  await fs.writeFile(outside, "private");
  assert.equal(await allowedResource(pathToFileURL(outside).href, dist), false);
  await fs.symlink(outside, path.join(dist, "pals", "linked.glb"));
  assert.equal(
    await allowedResource(
      pathToFileURL(path.join(dist, "pals", "linked.glb")).href,
      dist,
    ),
    false,
  );
});
