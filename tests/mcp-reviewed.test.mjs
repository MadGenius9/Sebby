import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpReviewed } from "../electron/mcp-reviewed.mjs";
import { McpVault } from "../electron/mcp-vault.mjs";
import {
  parseStrictJSON,
  validateSchema,
  validateArguments,
  rejectSecrets,
} from "../electron/mcp-reviewed-schema.mjs";
const endpoint = {
  id: "connector-1",
  name: "Test MCP",
  type: "mcp",
  url: "https://tools.public-domain.org/mcp",
};
const schema = {
  type: "object",
  properties: { query: { type: "string", maxLength: 100 } },
  required: ["query"],
  additionalProperties: false,
};
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-reviewed-mcp-"),
  );
  let connector = { ...endpoint },
    generation = "generation-1";
  const calls = [],
    approvals = [];
  const connectors = {
    get: (id) => (id === endpoint.id ? connector : undefined),
  };
  const vault = {
    status: async () => ({ configured: true, generation }),
    getBound: async (id, url, g) => {
      assert.equal(id, endpoint.id);
      assert.equal(url, connector.url);
      assert.equal(g, generation);
      return "SYNTHETIC_MCP_ONLY_TOKEN";
    },
  };
  const transport = async (request) => {
    calls.push(request);
    const message = JSON.parse(request.body);
    const result =
      message.method === "tools/list"
        ? {
            resultType: "complete",
            tools: [
              {
                name: "search",
                description: "Untrusted description",
                inputSchema: schema,
              },
            ],
          }
        : {
            resultType: "complete",
            content: [
              { type: "text", text: "<script>untrusted output</script>" },
            ],
            isError: false,
          };
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
    };
  };
  const service = new McpReviewed({
    directory,
    connectors,
    vault,
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    approve: async (r) => {
      approvals.push(r);
      return true;
    },
    transport,
    ...options,
  });
  await service.load();
  t.after(async () => {
    service.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    service,
    directory,
    connectors,
    vault,
    calls,
    approvals,
    transport,
    changeEndpoint: () => {
      connector = { ...connector, url: "https://other.public-domain.org/mcp" };
    },
    remove: () => {
      connector = null;
    },
    rotate: () => {
      generation = "generation-2";
    },
  };
}
async function prepared(f) {
  const d = await f.service.discover(endpoint.id);
  assert.equal(d.status, "ready");
  const g = await f.service.grant({
    catalogId: d.catalog.id,
    toolName: "search",
  });
  assert.equal(g.approved, true);
  const p = await f.service.prepare({
    catalogId: d.catalog.id,
    toolName: "search",
    argumentsJson: '{"query":"hello"}',
  });
  assert.equal(p.status, "ready");
  return p.proposal;
}
test("reviewed authenticated call uses exact endpoint, token header, full immutable input and metadata-only history", async (t) => {
  const f = await fixture(t);
  const p = await prepared(f);
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.calls[0].headers.Authorization,
    "Bearer SYNTHETIC_MCP_ONLY_TOKEN",
  );
  assert.equal(f.calls[0].url, endpoint.url);
  p.argumentsJson = '{"query":"renderer changed"}';
  const r = await f.service.invoke({ proposalId: p.id, digest: p.digest });
  assert.equal(r.status, "completed");
  assert.equal(r.output.untrusted, true);
  assert.equal(r.output.text[0], "<script>untrusted output</script>");
  const request = JSON.parse(f.calls[1].body);
  assert.equal(request.method, "tools/call");
  assert.deepEqual(request.params.arguments, { query: "hello" });
  assert.equal(
    request.params._meta["io.modelcontextprotocol/protocolVersion"],
    "2026-07-28",
  );
  assert.match(f.approvals.at(-1).description, /UNKNOWN/);
  assert.equal(JSON.parse(f.approvals.at(-1).argumentsJson).query, "hello");
  assert.equal(
    JSON.stringify(f.approvals).includes("SYNTHETIC_MCP_ONLY_TOKEN"),
    false,
  );
  const history = await fs.readFile(
    path.join(f.directory, "sebby-mcp-history/history.json"),
    "utf8",
  );
  assert.equal(history.includes("hello"), false);
  assert.equal(history.includes("untrusted output"), false);
  assert.equal(history.includes("SYNTHETIC"), false);
  assert.equal(
    (await f.service.invoke({ proposalId: p.id, digest: p.digest })).status,
    "error",
  );
  assert.equal(f.calls.length, 2);
});
test("native denied call has no remote effects and no journal", async (t) => {
  let allow = true;
  const f = await fixture(t, { approve: async () => allow });
  const p = await prepared(f);
  allow = false;
  assert.equal(
    (await f.service.invoke({ proposalId: p.id, digest: p.digest })).status,
    "denied",
  );
  assert.equal(f.calls.length, 1);
  assert.deepEqual((await f.service.status(endpoint.id)).history, []);
});
test("strict JSON and bounded schema reject duplicates, prototype pollution, references, regex and credential fields", () => {
  for (const s of [
    '{"x":1,"x":2}',
    '{"__proto__":{}}',
    '{"x":{"constructor":1}}',
    '{"n":1e999}',
  ])
    assert.throws(() => parseStrictJSON(s));
  for (const patch of [
    { $ref: "https://evil.org/schema" },
    { pattern: "(a+)+$" },
    { oneOf: [] },
    { properties: { api_key: { type: "string" } } },
  ])
    assert.throws(() => validateSchema({ ...schema, ...patch }));
  assert.throws(() =>
    validateArguments(schema, parseStrictJSON('{"query":"Bearer abcdefgh"}')),
  );
  assert.throws(() => rejectSecrets({ nested: { password: "plain" } }));
  assert.throws(() => validateArguments(schema, { query: "x", extra: true }));
});
test("endpoint/token/schema grants never carry over; removal blocks prepared call", async (t) => {
  for (const change of ["changeEndpoint", "rotate", "remove"]) {
    const f = await fixture(t);
    const p = await prepared(f);
    f[change]();
    assert.equal(
      (await f.service.invoke({ proposalId: p.id, digest: p.digest })).status,
      "error",
    );
    assert.equal(f.calls.length, 1);
  }
});
test("rediscovery invalidates granted tools and prepared inputs even unchanged schema", async (t) => {
  const f = await fixture(t);
  const p = await prepared(f);
  await f.service.discover(endpoint.id);
  assert.equal(
    (await f.service.invoke({ proposalId: p.id, digest: p.digest })).status,
    "error",
  );
  assert.deepEqual((await f.service.status(endpoint.id)).grants, []);
});
test("private/mixed DNS answers fail before credentials or transport", async (t) => {
  let reads = 0;
  const f = await fixture(t, {
    resolve: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    vault: {
      status: async () => ({ configured: true, generation: "x" }),
      getBound: async () => {
        reads++;
        return "fake";
      },
    },
  });
  assert.equal((await f.service.discover(endpoint.id)).status, "error");
  assert.equal(reads, 0);
  assert.equal(f.calls.length, 0);
});
test("redirects, auth challenges and SSE rejected without retry", async (t) => {
  for (const response of [
    { status: 302, headers: { location: "https://evil.org" }, body: "" },
    {
      status: 401,
      headers: {
        "www-authenticate": 'Bearer resource_metadata="https://evil.org"',
      },
      body: "",
    },
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: "data: bad",
    },
  ]) {
    let calls = 0;
    const f = await fixture(t, {
      transport: async () => {
        calls++;
        return response;
      },
    });
    assert.equal((await f.service.discover(endpoint.id)).status, "error");
    assert.equal(calls, 1);
  }
});
test("postdispatch error is durable uncertain; no replay or secret echo", async (t) => {
  const f = await fixture(t);
  const p = await prepared(f);
  f.service.transport = async () => {
    throw Error("SYNTHETIC_MCP_ONLY_TOKEN");
  };
  const r = await f.service.invoke({ proposalId: p.id, digest: p.digest });
  assert.equal(r.status, "uncertain");
  assert.equal(JSON.stringify(r).includes("SYNTHETIC"), false);
  const restarted = new McpReviewed({
    directory: f.directory,
    connectors: f.connectors,
    vault: f.vault,
  });
  await restarted.load();
  assert.equal(
    (await restarted.status(endpoint.id)).history[0].status,
    "uncertain",
  );
  assert.deepEqual((await restarted.status(endpoint.id)).grants, []);
  restarted.shutdown();
});
test("crash-era dispatching metadata recovers as uncertain, with no body replay", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.directory, "sebby-mcp-history"));
  await fs.writeFile(
    path.join(f.directory, "sebby-mcp-history/history.json"),
    JSON.stringify([
      {
        id: "11111111-1111-4111-8111-111111111111",
        connectorId: endpoint.id,
        url: endpoint.url,
        toolName: "search",
        schemaDigest: "a".repeat(64),
        inputDigest: "b".repeat(64),
        createdAt: 1,
        updatedAt: 1,
        status: "dispatching",
      },
    ]),
  );
  await f.service.load();
  assert.equal(
    (await f.service.status(endpoint.id)).history[0].status,
    "uncertain",
  );
  assert.equal(f.calls.length, 0);
});
test("cancel during invocation consent never dispatches, pending state drains", async (t) => {
  let release;
  const f = await fixture(t);
  const p = await prepared(f);
  f.service.approve = () => new Promise((r) => (release = r));
  const result = f.service.invoke({ proposalId: p.id, digest: p.digest });
  await new Promise((r) => setImmediate(r));
  assert.equal(f.service.isBusy(), true);
  f.service.cancel();
  release(true);
  assert.equal((await result).status, "cancelled-before-dispatch");
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.isBusy(), false);
});
test("vault securely binds exact endpoint and rotates generation, fails closed basic_text", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-mcp-vault-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let c = { ...endpoint };
  const prompts = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "test-only",
    encryptString: (s) =>
      Buffer.from("TEST-ENCRYPTED:" + Buffer.from(s).toString("base64")),
    decryptString: (b) =>
      Buffer.from(b.toString().slice(15), "base64").toString(),
  };
  const v = new McpVault({
    directory,
    safeStorage,
    connectors: { get: () => c },
    approve: async (r) => {
      prompts.push(r);
      return true;
    },
  });
  await v.load();
  assert.equal((await v.status(c.id)).configured, false);
  await v.save({ connectorId: c.id, token: "SYNTHETIC_MCP_ONLY_TOKEN" });
  const first = await v.status(c.id);
  assert.equal(
    await v.getBound(c.id, c.url, first.generation),
    "SYNTHETIC_MCP_ONLY_TOKEN",
  );
  await v.save({ connectorId: c.id, token: "ANOTHER_SYNTHETIC_TOKEN" });
  assert.notEqual((await v.status(c.id)).generation, first.generation);
  assert.equal(JSON.stringify(prompts).includes("SYNTHETIC"), false);
  c = { ...c, url: "https://changed.public-domain.org/mcp" };
  assert.equal((await v.status(c.id)).configured, false);
  await assert.rejects(v.getBound(c.id, endpoint.url, first.generation));
  safeStorage.getSelectedStorageBackend = () => "basic_text";
  await assert.rejects(
    v.save({ connectorId: c.id, token: "SYNTHETIC_MCP_ONLY_TOKEN" }),
  );
  await v.shutdown();
});
test("full journal blocks before invocation approval and preserves unresolved evidence", async (t) => {
  const f = await fixture(t);
  const p = await prepared(f);
  f.service.history = Array.from({ length: 200 }, (_, i) => ({
    id: `record-${i}`,
    status: "uncertain",
  }));
  const count = f.approvals.length;
  assert.equal(
    (await f.service.invoke({ proposalId: p.id, digest: p.digest })).status,
    "error",
  );
  assert.equal(f.approvals.length, count);
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.history[0].id, "record-0");
});
test("string length constraints count Unicode code points", () => {
  const s = {
    type: "object",
    properties: { value: { type: "string", minLength: 2, maxLength: 2 } },
  };
  validateSchema(s);
  assert.throws(() => validateArguments(s, { value: "😀" }));
  assert.deepEqual(validateArguments(s, { value: "😀😀" }), { value: "😀😀" });
});
test("cancellation during slow credential status cannot open a later native prompt", async (t) => {
  let release;
  const f = await fixture(t, {
    vault: { status: () => new Promise((r) => (release = r)) },
  });
  const p = f.service.discover(endpoint.id);
  await new Promise((r) => setImmediate(r));
  f.service.cancel();
  release({ configured: true, generation: "x" });
  assert.equal((await p).status, "cancelled");
  assert.equal(f.approvals.length, 0);
});
test("vault token input clears synchronously and rejected encryption cannot echo secret", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-vault-clear-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const v = new McpVault({
    directory,
    connectors: { get: () => endpoint },
    approve: async () => true,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw Error("SYNTHETIC_TOKEN_EXPOSED");
      },
    },
  });
  const input = { connectorId: endpoint.id, token: "SYNTHETIC_TOKEN_EXPOSED" };
  const p = v.save(input);
  assert.equal(input.token, "");
  await assert.rejects(p, (e) => !e.message.includes("SYNTHETIC"));
  await v.shutdown();
});
test("symlinked vault file is refused before decryption", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-vault-link-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dir = path.join(directory, "sebby-mcp-vault");
  await fs.mkdir(dir);
  const target = path.join(directory, "outside");
  await fs.writeFile(target, "not a vault");
  try {
    await fs.symlink(target, path.join(dir, "credentials.bin"));
  } catch (e) {
    if (e.code === "EPERM") {
      t.skip("Symlink creation unavailable");
      return;
    }
    throw e;
  }
  const v = new McpVault({
    directory,
    connectors: { get: () => endpoint },
    safeStorage: {
      isEncryptionAvailable: () => true,
      decryptString: () => {
        throw Error("must not decrypt");
      },
    },
  });
  await assert.rejects(v.status(endpoint.id), /storage unavailable/);
});
test("full input review escapes directional control characters without changing sent JSON values", async (t) => {
  const f = await fixture(t);
  const d = await f.service.discover(endpoint.id);
  await f.service.grant({ catalogId: d.catalog.id, toolName: "search" });
  const p = await f.service.prepare({
    catalogId: d.catalog.id,
    toolName: "search",
    argumentsJson: JSON.stringify({ query: "abc\u202edef" }),
  });
  assert.equal(p.proposal.argumentsJson.includes("\u202e"), false);
  assert.equal(p.proposal.argumentsJson.includes("\\u202e"), true);
  assert.equal(JSON.parse(p.proposal.argumentsJson).query, "abc\u202edef");
});
