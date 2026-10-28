import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConnectorStore, validateConnector } from "../electron/connectors.mjs";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-connectors-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ConnectorStore(dir);
  await store.load();
  return { dir, store };
}
test("GitHub repository canonicalization and disconnected persistence", async (t) => {
  const { dir, store } = await fixture(t);
  const x = await store.add({
    name: "Sebby",
    type: "github",
    url: "https://github.com/MadGenius9/Sebby.git",
  });
  assert.equal(x.url, "https://github.com/MadGenius9/Sebby");
  assert.equal(x.enabled, false);
  assert.equal(x.status, "configured-not-connected");
  assert.deepEqual(x.requestedScopes, ["repository:read"]);
  const next = new ConnectorStore(dir);
  await next.load();
  assert.equal(next.list()[0].id, x.id);
  await next.update(x.id, { name: "My project" });
  assert.equal(next.get(x.id).name, "My project");
  await assert.rejects(next.remove(x.id), /Confirm/);
  await next.remove(x.id, { confirmed: true });
  assert.equal(next.list().length, 0);
});
test("connector registry rejects credentials, secrets, scripts and authority expansion", () => {
  const base = {
    name: "Test",
    type: "mcp",
    url: "https://mcp.vendor.com/tools",
  };
  for (const url of [
    "http://mcp.vendor.com",
    "https://user:pass@mcp.vendor.com",
    "https://mcp.vendor.com?token=abc",
    "https://mcp.vendor.com#x",
    "https://mcp.vendor.com:444",
    "https://mcp.vendor.com/token/abc",
    "https://mcp.vendor.com/%61",
  ])
    assert.throws(() => validateConnector({ ...base, url }), undefined, url);
  for (const patch of [
    { token: "secret" },
    { command: "node" },
    { enabled: true },
    { scopes: ["write"] },
  ])
    assert.throws(() => validateConnector({ ...base, ...patch }));
  assert.throws(() =>
    validateConnector({ ...base, name: "ghp_abcdefghijklmnopqrstuvwxyz" }),
  );
});
test("MCP bookmarks conservatively reject local IP and private-name targets", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.1",
    "[::1]",
    "2130706433",
    "local.test",
    "mcp.internal",
    "foo.local",
    "xn--example.com",
  ])
    assert.throws(
      () =>
        validateConnector({
          name: "MCP",
          type: "mcp",
          url: `https://${host}/mcp`,
        }),
      undefined,
      host,
    );
  assert.equal(
    validateConnector({
      name: "MCP",
      type: "mcp",
      url: "https://mcp.vendor.com/mcp",
    }).type,
    "mcp",
  );
});
test("imports are atomic, additive, confirmed and secret-free", async (t) => {
  const { store } = await fixture(t);
  const input = {
    version: 1,
    connectors: [
      { name: "MCP", type: "mcp", url: "https://mcp.vendor.com/mcp" },
    ],
  };
  await assert.rejects(store.import(input), /Confirm/);
  await store.import(input, { confirmed: true });
  await assert.rejects(store.import(input, { confirmed: true }), /Duplicate/);
  await assert.rejects(
    store.import(
      { version: 1, connectors: [{ ...input.connectors[0], token: "secret" }] },
      { confirmed: true },
    ),
  );
  assert.deepEqual(store.export(), input);
  assert.equal(store.list().length, 1);
});
test("configuration rejects corrupt state without overwriting it", async (t) => {
  const { dir } = await fixture(t);
  const file = path.join(dir, "sebby-connectors.json");
  await fs.writeFile(file, "broken");
  const store = new ConnectorStore(dir);
  await assert.rejects(store.load(), /not overwritten/);
  assert.throws(() => store.list(), /Load/);
  assert.equal(await fs.readFile(file, "utf8"), "broken");
});
