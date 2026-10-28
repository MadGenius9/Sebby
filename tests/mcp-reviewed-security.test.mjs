import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseStrictJSON,
  validateSchema,
  validateArguments,
} from "../electron/mcp-reviewed-schema.mjs";
import { McpVault } from "../electron/mcp-vault.mjs";
import { McpReviewed } from "../electron/mcp-reviewed.mjs";
const url = "https://tools.public-domain.org/mcp";
const connectors = { get: () => ({ name: "Fixture MCP", type: "mcp", url }) };
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-mcp-review-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("strict parser rejects escaped duplicate and prototype keys at every nesting level", () => {
  for (const value of [
    '{"a":1,"\\u0061":2}',
    '{"nested":{"\\u005f_proto__":1}}',
    '{"nested":{"constructor":{}}}',
    '{"nested":{"prototype":{}}}',
  ])
    assert.throws(() => parseStrictJSON(value));
  assert.throws(() => parseStrictJSON("1e999"));
  assert.throws(() => parseStrictJSON("[".repeat(14) + "0" + "]".repeat(14)));
});
test("schema string length counts Unicode code points, not UTF16 surrogate units", () => {
  const schema = validateSchema({
    type: "object",
    properties: { value: { type: "string", minLength: 2, maxLength: 2 } },
    required: ["value"],
    additionalProperties: false,
  });
  assert.throws(() =>
    validateArguments(schema, parseStrictJSON('{"value":"😀"}')),
  );
  assert.doesNotThrow(() =>
    validateArguments(schema, parseStrictJSON('{"value":"😀x"}')),
  );
});
test("MCP vault encryptor failures never echo entered credential", async (t) => {
  const token = "SYNTHETIC_MCP_TOKEN_NOT_REAL";
  let encryptionAttempted = false;
  const vault = new McpVault({
    directory: await directory(t),
    connectors,
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "test-only",
      encryptString: () => {
        encryptionAttempted = true;
        throw Error(token);
      },
    },
    approve: async () => true,
  });
  const input = { connectorId: "fixture", token };
  await assert.rejects(
    vault.save(input),
    (error) => !error.message.includes(token),
  );
  assert.equal(input.token, "");
  assert.equal(encryptionAttempted, true);
});
test("full journal never evicts unresolved effect evidence to dispatch another tool", async (t) => {
  let requests = 0;
  const service = new McpReviewed({
    directory: await directory(t),
    connectors,
    vault: {
      status: async () => ({
        configured: true,
        generation: "fixture-generation",
      }),
      getBound: async () => "SYNTHETIC_MCP_TOKEN",
    },
    approve: async () => true,
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport: async (request) => {
      requests++;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: JSON.parse(request.body).id,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "fixture" }],
          },
        }),
      };
    },
  });
  const id = randomUUID(),
    schemaDigest = "a".repeat(64);
  const catalog = {
    id,
    connectorId: "fixture",
    url,
    generation: "fixture-generation",
    createdAt: Date.now(),
    tools: [
      {
        name: "fixture_tool",
        schemaDigest,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  };
  service.catalogs.set(id, catalog);
  service.grants.set(service.key(catalog, "fixture_tool"), {
    connectorId: "fixture",
    url,
    generation: "fixture-generation",
    toolName: "fixture_tool",
    schemaDigest,
  });
  service.history = Array.from({ length: 200 }, () => ({
    id: randomUUID(),
    connectorId: "fixture",
    url,
    toolName: "fixture_tool",
    schemaDigest,
    inputDigest: "b".repeat(64),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "uncertain",
  }));
  const first = service.history[0].id;
  const prepared = await service.prepare({
    catalogId: id,
    toolName: "fixture_tool",
    argumentsJson: "{}",
  });
  const result = await service.invoke({
    proposalId: prepared.proposal.id,
    digest: prepared.proposal.digest,
  });
  assert.notEqual(result.status, "completed");
  assert.equal(requests, 0);
  assert.equal(service.history.length, 200);
  assert.equal(service.history[0].id, first);
});
