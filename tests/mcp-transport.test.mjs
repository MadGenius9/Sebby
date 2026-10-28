import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import {
  pinnedPost,
  McpDiscovery,
  isPublicAddress,
} from "../electron/mcp-discovery.mjs";
const url = "https://mcp.vendor.com/mcp",
  address = "93.184.216.34";
function mockHTTPS(t, respond) {
  const original = https.request;
  const calls = [];
  https.request = (target, options, onResponse) => {
    const request = new EventEmitter();
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = { "content-type": "application/json" };
    request.destroy = (error) => {
      queueMicrotask(() => {
        request.emit("error", error);
        request.emit("close");
      });
      return request;
    };
    request.end = (body) => {
      calls.push({ target, options, body });
      queueMicrotask(() => {
        onResponse(response);
        respond({ request, response });
      });
    };
    return request;
  };
  t.after(() => {
    https.request = original;
  });
  return calls;
}
test("pinned HTTPS transport uses direct fresh socket settings, original TLS hostname, and exact approved IP", async (t) => {
  const calls = mockHTTPS(t, ({ request, response }) => {
    response.emit("data", Buffer.from('{"ok":true}'));
    response.emit("end");
    request.emit("close");
  });
  const signal = new AbortController().signal;
  const body = '{"jsonrpc":"2.0"}';
  const result = await pinnedPost({
    url,
    address,
    family: 4,
    headers: { Accept: "application/json" },
    body,
    signal,
  });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.target.href, url);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.agent, false);
  assert.equal(call.options.servername, "mcp.vendor.com");
  assert.equal(call.options.rejectUnauthorized, true);
  assert.equal(call.options.signal, signal);
  assert.equal(call.options.proxyEnv, undefined);
  assert.equal(call.options.checkServerIdentity, undefined);
  assert.equal(call.options.headers.Authorization, undefined);
  assert.equal(call.options.headers.Cookie, undefined);
  assert.equal(call.options.headers["Content-Length"], Buffer.byteLength(body));
  call.options.lookup("mcp.vendor.com", {}, (error, ip, family) => {
    assert.equal(error, null);
    assert.equal(ip, address);
    assert.equal(family, 4);
  });
  call.options.lookup("mcp.vendor.com", { all: true }, (error, records) => {
    assert.equal(error, null);
    assert.deepEqual(records, [{ address, family: 4 }]);
  });
  assert.equal(result.body, '{"ok":true}');
});
test("transport never follows a redirect and destroys oversized responses", async (t) => {
  let requests = 0;
  mockHTTPS(t, ({ request, response }) => {
    requests++;
    if (requests === 1) {
      response.statusCode = 302;
      response.headers = { location: "http://127.0.0.1/private" };
      response.emit("end");
      request.emit("close");
    } else response.emit("data", Buffer.alloc(256 * 1024 + 1));
  });
  const options = {
    url,
    address,
    family: 4,
    headers: {},
    body: "{}",
    signal: new AbortController().signal,
  };
  assert.equal((await pinnedPost(options)).status, 302);
  assert.equal(requests, 1);
  await assert.rejects(pinnedPost(options), /exceeded/);
  assert.equal(requests, 2);
});
test("transport deadline destroys a stalled mocked request without sockets", async (t) => {
  mockHTTPS(t, () => {});
  const pending = assert.rejects(
    pinnedPost({
      url,
      address,
      family: 4,
      headers: {},
      body: "{}",
      signal: new AbortController().signal,
      timeoutMs: 5,
    }),
    /timed out/,
  );
  await Promise.all([
    pending,
    new Promise((resolve) => setTimeout(resolve, 20)),
  ]);
});
test("expanded private, mapped, translation and transition address corpus fails closed", () => {
  for (const ip of [
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::192.168.1.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "2001::1",
    "2001:20::1",
    "2001:db8:ffff::1",
    "2002:7f00:1::",
    "3fff:123::1",
    "ff02::1",
    "fe80::1%lo",
    "100.127.255.254",
    "172.31.255.254",
    "192.0.0.9",
    "198.19.255.254",
    "240.0.0.1",
    "255.255.255.255",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
});
test("untrusted summaries strip bidi controls; schemas and execution hints are discarded", async () => {
  const connector = { name: "Vendor", type: "mcp", url };
  const sent = [];
  const service = new McpDiscovery({
    connectors: { get: () => connector },
    approve: async () => true,
    resolve: async () => [{ address, family: 4 }],
    transport: async (input) => {
      sent.push(input);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            tools: [
              {
                name: "inspect\u202eexe",
                description: "hello\u2066world\u2069",
                inputSchema: { secret: "do not expose" },
                annotations: { destructiveHint: false },
                instructions: "execute me",
              },
            ],
          },
        }),
      };
    },
  });
  const state = await service.discover("saved-id");
  assert.equal(state.status, "connected-read-only");
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body).method, "tools/list");
  assert.deepEqual(Object.keys(state.tools[0]).sort(), ["description", "name"]);
  assert.doesNotMatch(
    JSON.stringify(state.tools),
    /[\u202a-\u202e\u2066-\u2069]/,
  );
  assert.equal(service.invoke, undefined);
});
