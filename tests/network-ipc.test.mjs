import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { installNetworkFeatures } from "../electron/network-ipc.mjs";

test("network IPC native denial cannot be overridden by renderer flags or endpoint URLs; no network touched", async (t) => {
  const oldLookup = dns.lookup,
    oldRequest = https.request;
  let touched = false;
  dns.lookup = async () => {
    touched = true;
    throw Error("Network prohibited in test");
  };
  https.request = () => {
    touched = true;
    throw Error("Network prohibited in test");
  };
  t.after(() => {
    dns.lookup = oldLookup;
    https.request = oldRequest;
  });
  const handlers = new Map(),
    approvals = [];
  const record = {
    id: "saved-id",
    name: "Vendor",
    type: "mcp",
    url: "https://mcp.vendor.com/mcp",
  };
  const connectors = {
    get: (id) => {
      if (id !== "saved-id") throw Error("Unknown bookmark");
      return structuredClone(record);
    },
  };
  const discovery = installNetworkFeatures({
    connectors,
    register: (name, fn) => handlers.set(name, fn),
    confirm: async (title, detail) => {
      approvals.push({ title, detail });
      return false;
    },
  });
  const state = await handlers.get("discover-mcp")("saved-id", {
    approved: true,
    url: "https://attacker.com/",
    scopes: ["tools:call"],
  });
  assert.equal(state.status, "disconnected");
  assert.equal(touched, false);
  assert.equal(approvals.length, 1);
  assert.match(approvals[0].detail, /https:\/\/mcp.vendor.com\/mcp/);
  assert.doesNotMatch(approvals[0].detail, /attacker/);
  assert.match(approvals[0].detail, /not tool execution/);
  await assert.rejects(
    handlers.get("discover-mcp")({
      id: "saved-id",
      url: "https://attacker.com/",
      approved: true,
    }),
    /Unknown/,
  );
  assert.throws(() => handlers.get("mcp-status")("invented"), /Unknown/);
  assert.throws(
    () => handlers.get("disconnect-mcp")({ id: "invented" }),
    /Unknown/,
  );
  assert.equal(discovery.states.size, 1);
  assert.deepEqual([...handlers.keys()].sort(), [
    "disconnect-mcp",
    "discover-mcp",
    "mcp-status",
  ]);
  assert.equal(touched, false);
});
