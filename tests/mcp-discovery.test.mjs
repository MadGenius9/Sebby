import test from "node:test";
import assert from "node:assert/strict";
import { McpDiscovery, isPublicAddress } from "../electron/mcp-discovery.mjs";
const record = {
  id: "mcp-id",
  name: "MCP",
  type: "mcp",
  url: "https://mcp.vendor.com/mcp",
};
const response = (
  result = {
    resultType: "complete",
    tools: [
      {
        name: "inspect",
        description: "Untrusted tool description",
        inputSchema: { type: "object" },
      },
    ],
  },
) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
});
function fixture(overrides = {}) {
  const sent = [];
  const service = new McpDiscovery({
    connectors: { get: () => record },
    approve: async () => true,
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (req) => {
      sent.push(req);
      return response();
    },
    now: () => 1234,
    ...overrides,
  });
  return { service, sent };
}
test("MCP discovery uses one modern metadata-bearing tools/list only and explicit approval", async () => {
  const { service, sent } = fixture();
  const state = await service.discover("mcp-id");
  assert.equal(state.status, "connected-read-only");
  assert.equal(state.checkedAt, 1234);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers["Mcp-Method"], "tools/list");
  assert.equal(sent[0].headers["MCP-Protocol-Version"], "2026-07-28");
  const body = JSON.parse(sent[0].body);
  assert.equal(body.method, "tools/list");
  assert.equal(
    body.params._meta["io.modelcontextprotocol/protocolVersion"],
    "2026-07-28",
  );
  assert.deepEqual(
    body.params._meta["io.modelcontextprotocol/clientCapabilities"],
    {},
  );
  assert.equal(sent[0].address, "93.184.216.34");
  assert.equal(sent[0].headers.Authorization, undefined);
  assert.equal(state.tools[0].name, "inspect");
  assert.equal(service.disconnect("mcp-id").status, "disconnected");
});
test("denying discovery performs no DNS resolution or HTTP request", async () => {
  let accessed = false;
  const { service } = fixture({
    approve: async () => false,
    resolve: async () => {
      accessed = true;
      return [];
    },
    transport: async () => {
      accessed = true;
    },
  });
  assert.equal((await service.discover("mcp-id")).status, "disconnected");
  assert.equal(accessed, false);
});
test("public-address policy rejects private, metadata, multicast, documentation and mapped addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "::ffff:93.184.216.34",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002::1",
    "invalid",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
test("mixed DNS results are rejected before transport; DNS rechecked each attempt", async () => {
  let calls = 0;
  const { service, sent } = fixture({
    resolve: async () => {
      calls++;
      return calls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ];
    },
  });
  assert.equal(
    (await service.discover("mcp-id")).status,
    "connected-read-only",
  );
  assert.equal((await service.discover("mcp-id")).status, "error");
  assert.equal(sent.length, 1);
});
test("redirects, authorization challenges, SSE and remote errors fail closed", async () => {
  for (const r of [
    { ...response(), status: 302 },
    { ...response(), status: 401 },
    { ...response(), headers: { "content-type": "text/event-stream" } },
    {
      ...response(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "SECRET SERVER ERROR" },
      }),
    },
  ]) {
    let calls = 0;
    const { service } = fixture({
      transport: async () => {
        calls++;
        return r;
      },
    });
    const result = await service.discover("mcp-id");
    assert.equal(result.status, "error");
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
  }
});
test("catalog truncation and input-required results never grant execution or follow-up", async () => {
  const tools = Array.from({ length: 101 }, (_, i) => ({
    name: "tool" + i,
    description: "x".repeat(1100),
  }));
  const { service } = fixture({
    transport: async () =>
      response({ resultType: "complete", tools, nextCursor: "abc" }),
  });
  const result = await service.discover("mcp-id");
  assert.equal(result.tools.length, 100);
  assert.equal(result.tools[0].description.length, 1000);
  assert.equal(result.truncated, true);
  const other = fixture({
    transport: async () =>
      response({ resultType: "input_required", inputRequests: {} }),
  });
  assert.equal((await other.service.discover("mcp-id")).status, "error");
});
test("disconnect aborts active request without reconnecting", async () => {
  let started;
  const start = new Promise((resolve) => (started = resolve));
  const { service } = fixture({
    transport: async (req) => {
      started();
      return new Promise((_, reject) =>
        req.signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      );
    },
  });
  const pending = service.discover("mcp-id");
  await start;
  service.disconnect("mcp-id");
  assert.equal((await pending).status, "disconnected");
});
test("disconnect settles even while an injected DNS resolver never responds", async () => {
  let started;
  const start = new Promise((resolve) => (started = resolve));
  const { service } = fixture({
    resolve: () => {
      started();
      return new Promise(() => {});
    },
  });
  const pending = service.discover("mcp-id");
  await start;
  service.disconnect("mcp-id");
  assert.equal((await pending).status, "disconnected");
});
test("shutdown aborts every active request and refuses future discovery", async () => {
  let started;
  const start = new Promise((resolve) => (started = resolve));
  const { service } = fixture({
    transport: (req) => {
      started();
      return new Promise((_, reject) =>
        req.signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        }),
      );
    },
  });
  const pending = service.discover("mcp-id");
  await start;
  assert.equal(service.isBusy(), true);
  service.shutdown();
  assert.equal((await pending).status, "disconnected");
  assert.equal(service.isBusy(), false);
  await assert.rejects(service.discover("mcp-id"), /shutting down/);
});
