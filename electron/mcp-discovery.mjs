import https from "node:https";
import dns from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { validateConnector } from "./connectors.mjs";
const VERSION = "2026-07-28",
  MAX_BYTES = 256 * 1024;
const denied4 = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  denied4.addSubnet(ip, bits, "ipv4");
const allowed6 = new BlockList();
allowed6.addSubnet("2000::", 3, "ipv6");
const denied6 = new BlockList();
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
])
  denied6.addSubnet(ip, bits, "ipv6");
export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4
    ? !denied4.check(address, "ipv4")
    : family === 6 &&
        allowed6.check(address, "ipv6") &&
        !denied6.check(address, "ipv6");
}
class DiscoveryError extends Error {}
const fail = (message) => {
  throw new DiscoveryError(message);
};
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DiscoveryError("Discovery cancelled or timed out."));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
const label = (value, max) =>
  typeof value === "string"
    ? value
        .replace(
          /[\x00-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
          " ",
        )
        .slice(0, max)
    : "";
/** Direct HTTPS only: no proxy environment, cookies, auth, redirects or connection reuse. */
export function pinnedPost({
  url,
  address,
  family,
  headers,
  body,
  signal,
  timeoutMs = 8000,
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      new URL(url),
      {
        method: "POST",
        agent: false,
        servername: new URL(url).hostname,
        rejectUnauthorized: true,
        signal,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        lookup: (_host, options, callback) =>
          options?.all
            ? callback(null, [{ address, family }])
            : callback(null, address, family),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(
              new DiscoveryError(
                "Server response exceeded the discovery limit.",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => request.destroy(new DiscoveryError("Discovery request timed out.")),
      timeoutMs,
    );
    timer.unref?.();
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end(body);
  });
}
export class McpDiscovery {
  constructor({
    connectors,
    approve = async () => false,
    resolve = (host) => dns.lookup(host, { all: true, verbatim: true }),
    transport = pinnedPost,
    now = () => Date.now(),
  } = {}) {
    this.connectors = connectors;
    this.approve = approve;
    this.resolve = resolve;
    this.transport = transport;
    this.now = now;
    this.states = new Map();
    this.active = new Map();
    this.closed = false;
  }
  remember(id, state) {
    if (this.states.size >= 50 && !this.states.has(id))
      this.states.delete(this.states.keys().next().value);
    this.states.set(id, state);
  }
  isBusy() {
    return this.active.size > 0;
  }
  shutdown() {
    this.closed = true;
    for (const id of this.active.keys()) this.disconnect(id);
  }
  status(id) {
    return structuredClone(
      this.states.get(id) || {
        connectorId: id,
        status: "disconnected",
        checkedAt: null,
        tools: [],
      },
    );
  }
  disconnect(id) {
    this.active.get(id)?.abort();
    this.remember(id, {
      connectorId: id,
      status: "disconnected",
      checkedAt: this.now(),
      tools: [],
    });
    return this.status(id);
  }
  async discover(id) {
    if (this.closed) throw Error("Discovery is shutting down.");
    if (this.active.size >= 10)
      throw Error("Too many discovery requests are active.");
    if (this.active.has(id))
      throw Error("Discovery is already in progress for this connector.");
    const stored = this.connectors.get(id);
    const endpoint = validateConnector({
      name: stored.name,
      type: stored.type,
      url: stored.url,
    });
    if (endpoint.type !== "mcp")
      throw Error("Choose an MCP connector bookmark.");
    const controller = new AbortController();
    this.active.set(id, controller);
    let timer;
    try {
      if (
        !(await this.approve({
          connectorId: id,
          name: endpoint.name,
          url: endpoint.url,
          action: "mcp-read-only-discovery",
          description:
            "Send Sebby client name/version to this endpoint, make one read-only MCP tools/list request for tool names/descriptions. The endpoint sees your public IP and normal network metadata; DNS lookup reveals the hostname. No tools run, credentials sent, project content sent, or access granted.",
        }))
      )
        return this.disconnect(id);
      if (controller.signal.aborted) return this.status(id);
      timer = setTimeout(() => controller.abort(), 30000);
      timer.unref?.();
      let sequence = 0;
      const post = async () => {
        const method = "tools/list";
        if (controller.signal.aborted)
          fail("Discovery cancelled or timed out.");
        const records = await abortable(
          this.resolve(new URL(endpoint.url).hostname),
          controller.signal,
        );
        if (
          !Array.isArray(records) ||
          !records.length ||
          records.length > 32 ||
          records.some(
            (record) =>
              !isPublicAddress(record.address) ||
              record.family !== isIP(record.address),
          )
        )
          fail(
            "Endpoint did not resolve exclusively to permitted public addresses.",
          );
        if (controller.signal.aborted)
          fail("Discovery cancelled or timed out.");
        const requestId = ++sequence;
        const message = {
          jsonrpc: "2.0",
          id: requestId,
          method,
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": VERSION,
              "io.modelcontextprotocol/clientInfo": {
                name: "Sebby",
                version: "0.3.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        };
        const headers = {
          "Content-Type": "application/json",
          Accept: "application/json",
          "MCP-Protocol-Version": VERSION,
          "Mcp-Method": method,
        };
        const response = await abortable(
          this.transport({
            url: endpoint.url,
            ...records[0],
            headers,
            body: JSON.stringify(message),
            signal: controller.signal,
            timeoutMs: 8000,
          }),
          controller.signal,
        );
        if (controller.signal.aborted)
          fail("Discovery cancelled or timed out.");
        if (
          !response ||
          typeof response.body !== "string" ||
          Buffer.byteLength(response.body) > MAX_BYTES
        )
          fail("Invalid or oversized discovery response.");
        if (response.status >= 300 && response.status < 400)
          fail("Endpoint redirects are not followed.");
        if ([401, 403].includes(response.status))
          fail(
            "This endpoint requires authorization; credential setup is not supported here.",
          );
        if (response.status !== 200)
          fail("Endpoint rejected the discovery request.");
        const contentType = response.headers?.["content-type"];
        if (
          typeof contentType !== "string" ||
          !/^application\/json(?:\s*;|$)/i.test(contentType)
        )
          fail(
            "Only JSON responses are supported by this discovery subset; SSE is not supported.",
          );
        let data;
        try {
          data = JSON.parse(response.body);
        } catch {
          fail("Server returned invalid JSON.");
        }
        if (
          !data ||
          Array.isArray(data) ||
          data.jsonrpc !== "2.0" ||
          data.id !== requestId ||
          data.error ||
          !data.result ||
          typeof data.result !== "object" ||
          Array.isArray(data.result)
        )
          fail(
            "Server returned an invalid or unsuccessful discovery response.",
          );
        return data.result;
      };
      const listed = await post();
      if (
        listed.resultType !== "complete" ||
        !Array.isArray(listed.tools) ||
        listed.tools.length > 500
      )
        fail("Invalid, incomplete, or oversized tool catalog.");
      const tools = listed.tools.slice(0, 100).map((tool) => {
        if (
          !tool ||
          typeof tool.name !== "string" ||
          !tool.name ||
          tool.name.length > 256
        )
          fail("Invalid tool metadata.");
        return {
          name: label(tool.name, 128),
          description: label(tool.description, 1000),
        };
      });
      const state = {
        connectorId: id,
        status: "connected-read-only",
        checkedAt: this.now(),
        protocolVersion: VERSION,
        tools,
        truncated: listed.tools.length > 100 || !!listed.nextCursor,
      };
      this.remember(id, state);
      return structuredClone(state);
    } catch (error) {
      const state = {
        connectorId: id,
        status: controller.signal.aborted ? "disconnected" : "error",
        checkedAt: this.now(),
        tools: [],
        error: controller.signal.aborted
          ? "Discovery cancelled or timed out."
          : error instanceof DiscoveryError
            ? error.message
            : "Discovery failed. No tool was executed.",
      };
      this.remember(id, state);
      return structuredClone(state);
    } finally {
      clearTimeout(timer);
      this.active.delete(id);
    }
  }
}
