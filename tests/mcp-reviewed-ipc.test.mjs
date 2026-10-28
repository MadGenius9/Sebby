import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installReviewedMcp } from "../electron/mcp-reviewed-ipc.mjs";
const token = "SYNTHETIC_MCP_TOKEN_FOR_TEST_ONLY";
const connector = {
  id: "mcp-test",
  name: "Test",
  type: "mcp",
  url: "https://tools.public-domain.org/mcp",
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(t, { gate, external = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-mcp-ipc-"));
  const handlers = new Map(),
    prompts = [];
  const service = await installReviewedMcp({
    directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "test-only",
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    connectors: {
      get: (id) => {
        assert.equal(id, connector.id);
        return connector;
      },
    },
    register: (name, fn) => handlers.set(name, fn),
    confirm: async (...args) => {
      prompts.push(args);
      return gate ? gate.promise : true;
    },
    isExternalBusy: () => external,
  });
  t.after(async () => {
    await service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, handlers, prompts, service };
}
test("reviewed MCP default has no credential/grants/network and exposes no token readback", async (t) => {
  const f = await fixture(t);
  const status = await f.handlers.get("reviewed-mcp-status")(connector.id);
  assert.equal(status.credential.configured, false);
  assert.equal(status.catalog, null);
  assert.deepEqual(status.grants, []);
  assert.equal(f.handlers.has("get-mcp-token"), false);
  assert.equal(f.handlers.has("update-mcp-history"), false);
  assert.equal(f.prompts.length, 0);
});
test("MCP token is never included in consent/status and must be removed before its bookmark", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.handlers.get("save-mcp-token")({
        connectorId: connector.id,
        token,
      })
    ).saved,
    true,
  );
  assert.equal(JSON.stringify(f.prompts).includes(token), false);
  const status = await f.handlers.get("reviewed-mcp-status")(connector.id);
  assert.equal(status.credential.configured, true);
  assert.equal(JSON.stringify(status).includes(token), false);
  await assert.rejects(
    () => f.service.beforeRemoveConnector(connector.id),
    /Remove this endpoint/,
  );
  await f.handlers.get("remove-mcp-token")(connector.id);
  await f.service.beforeRemoveConnector(connector.id);
});
test("pending MCP native consent reserves operation and late shutdown cannot save token", async (t) => {
  const gate = deferred(),
    f = await fixture(t, { gate });
  const save = f.handlers.get("save-mcp-token")({
    connectorId: connector.id,
    token,
  });
  while (!f.prompts.length)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.service.isBusy(), true);
  assert.throws(
    () => f.handlers.get("discover-reviewed-mcp")(connector.id),
    /Finish or cancel/,
  );
  await assert.rejects(
    () => f.service.beforeRemoveConnector(connector.id),
    /Finish active/,
  );
  const shutdown = f.service.shutdown();
  gate.resolve(true);
  assert.equal((await save).saved, false);
  await shutdown;
  await assert.rejects(
    () => fs.stat(path.join(f.directory, "sebby-mcp-vault", "credentials.bin")),
    { code: "ENOENT" },
  );
});
test("ordinary discovery blocks reviewed credential mutation without asking or sending", async (t) => {
  const f = await fixture(t, { external: true });
  assert.throws(
    () =>
      f.handlers.get("save-mcp-token")({ connectorId: connector.id, token }),
    /Finish or cancel/,
  );
  assert.equal(f.prompts.length, 0);
});
