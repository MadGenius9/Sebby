import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(os.tmpdir(), "sebby-loop-fixture-"));
let instructions = "",
  observedTool = false,
  requests = 0;
let gatewayWork: (response: any) => Promise<void> = async () => {};
const server = createServer(async (req, res) => {
  requests++;
  let body = "";
  for await (const chunk of req) body += chunk;
  instructions = JSON.parse(body).instructions;
  res.writeHead(200, { "content-type": "text/event-stream" });
  try {
    await gatewayWork(res);
  } catch (e) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: (e as Error).message })}\n\n`,
    );
  } finally {
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as any).port;
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(dir, "test.db");
process.env.HERMES_URL = `http://127.0.0.1:${port}`;
process.env.HERMES_HOME_PRIMARY = path.join(dir, "hermes");
const { db } = await import("../server/src/db.js");
const { initRooms } = await import("../server/src/agent/rooms.js");
const { initSubagents } = await import("../server/src/agent/subagents.js");
initRooms();
initSubagents();
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { bindAgent } = await import("../server/src/workspace/collaboration.js");
const { enqueue, isBotBusy } = await import("../server/src/agent/loop.js");
const { mcpApi } = await import("../server/src/mcp.js");
const { mcpToken } = await import("../server/src/engine.js");
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a scripted Hermes gateway exercises a headless project turn and real MCP tool routing", async () => {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run("alice", "alice@example.test", "Alice", Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run("alice", "alice", Date.now(), Date.now() + 60000);
  db.prepare(
    "INSERT INTO bots(id,user_id,name,engine,is_primary,created_at,updated_at) VALUES (?,?,?,'primary',1,?,?)",
  ).run("bot-alice", "alice", "Fixture agent", Date.now(), Date.now());
  const response = await projectsApi.request("http://localhost/", {
    method: "POST",
    headers: {
      cookie: "grokbot_session=alice",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Loop fixture", template: "web" }),
  });
  const { project } = await response.json();
  const binding = bindAgent("alice", project.id, "bot-alice", false);
  gatewayWork = async (res) => {
    const item = {
      type: "function_call",
      name: "mcp_hq_project_overview",
      call_id: "fixture-call",
      arguments: "{}",
    };
    res.write(
      `event: response.output_item.added\ndata: ${JSON.stringify({ item })}\n\n`,
    );
    const rpc = await mcpApi.request("http://localhost/bot-alice", {
      method: "POST",
      headers: {
        authorization: `Bearer ${mcpToken("bot-alice")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "project_overview", arguments: {} },
      }),
    });
    const reply = await rpc.json();
    assert.equal(reply.result.isError, undefined);
    const overview = JSON.parse(reply.result.content[0].text);
    assert.equal(overview.projectId, project.id);
    assert.equal(overview.grantId, binding.grantId);
    observedTool = true;
    res.write(
      `event: response.output_item.added\ndata: ${JSON.stringify({ item: { type: "function_call_output", call_id: "fixture-call", output: reply.result.content } })}\n\n`,
    );
    res.write(
      `event: response.output_item.done\ndata: ${JSON.stringify({ item: { type: "message", phase: "commentary", content: [{ text: "Fixture progress update." }] } })}\n\n`,
    );
    res.write(
      `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: "Scripted gateway fixture finished reading the assigned project." })}\n\n`,
    );
  };
  enqueue("bot-alice", {
    type: "user",
    spokenReply: true,
    text: "Fixture request: inspect the assigned project.",
  });
  const limit = Date.now() + 10000;
  while (isBotBusy("bot-alice")) {
    if (Date.now() > limit) throw new Error("Turn did not finish");
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(requests, 1);
  assert.equal(observedTool, true);
  assert.match(instructions, /headless project turn/);
  assert.match(instructions, new RegExp(binding.grantId));
  const rows = db
    .prepare("SELECT body FROM rows WHERE bot_id=? ORDER BY seq")
    .all("bot-alice") as { body: string }[];
  const spoken = rows.map(row => JSON.parse(row.body)).filter(body => body.spokenReply);
  assert.deepEqual(spoken.map(body => body.text), [
    "Scripted gateway fixture finished reading the assigned project.",
  ]);
  assert.ok(
    rows.some((r) => {
      const b = JSON.parse(r.body);
      return (
        b.type === "tool-call" &&
        b.name === "project_overview" &&
        b.status === "done"
      );
    }),
  );
  assert.equal(
    (db.prepare("SELECT count(*) AS n FROM screens").get() as any).n,
    0,
  );
});
