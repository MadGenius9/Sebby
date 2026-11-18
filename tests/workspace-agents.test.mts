import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
const dir = mkdtempSync(path.join(os.tmpdir(), "sebby-agents-test-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(dir, "test.db");
process.env.SEBBY_RUNS_DIR = path.join(dir, "runs");
const { db } = await import("../server/src/db.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { collaborationApi } =
  await import("../server/src/workspace/collaboration-api.js");
const {
  bindAgent,
  bindingFor,
  unbindAgent,
  propose,
  reviewProposal,
  applyProposal,
  rejectProposal,
  proposalSummary,
} = await import("../server/src/workspace/collaboration.js");
const { WORKSPACE_TOOLS } =
  await import("../server/src/workspace/agent-tools.js");
const { RunService } = await import("../server/src/workspace/runs.js");
for (const id of ["alice", "bob"]) {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run(id, `${id}@example.test`, id, Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run(id, id, Date.now(), Date.now() + 600000);
  db.prepare(
    "INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
  ).run(`bot-${id}`, id, id, Date.now(), Date.now());
}
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const request = (
  app: any,
  method: string,
  url: string,
  user = "alice",
  body?: unknown,
) =>
  app.request(`http://localhost${url}`, {
    method,
    headers: {
      cookie: `grokbot_session=${user}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const create = async () =>
  (
    await (
      await request(projectsApi, "POST", "/", "alice", {
        name: "Agent project",
        template: "web",
      })
    ).json()
  ).project;
const invoke = async (
  name: string,
  args: unknown,
  context: any = { userId: "alice", botId: "bot-alice" },
) =>
  JSON.parse(
    (await WORKSPACE_TOOLS.find((t) => t.name === name)!.impl(args, context))
      .output,
  );
const proposalArgs = (
  p: any,
  b: any,
  content = 'console.log("proposed");\n',
) => ({
  projectId: p.id,
  grantId: b.grantId,
  revision: p.revision,
  summary: "Update browser behavior",
  changes: [{ path: "app.js", content }],
});

test("project assignments constrain agent reads and honor turn-pinned grants", async () => {
  const p = await create();
  await assert.rejects(invoke("project_overview", {}), /No project/);
  assert.equal(
    (
      await request(
        collaborationApi,
        "PUT",
        `/${p.id}/agents/bot-bob`,
        "alice",
        { allowRuns: false },
      )
    ).status,
    404,
  );
  const binding = bindAgent("alice", p.id, "bot-alice", false),
    overview = await invoke("project_overview", {});
  assert.equal(overview.projectId, p.id);
  assert.equal(overview.grantId, binding.grantId);
  assert.equal(overview.allowRuns, false);
  const scope = { projectId: p.id, grantId: binding.grantId, revision: 1 };
  const read = await invoke("project_read_file", { ...scope, path: "app.js" });
  assert.match(read.content, /clicks/);
  await assert.rejects(
    invoke(
      "project_read_file",
      { ...scope, path: "app.js" },
      { userId: "bob", botId: "bot-bob" },
    ),
    /not authorized/,
  );
  await assert.rejects(
    invoke(
      "project_overview",
      {},
      { userId: "alice", botId: "bot-alice", workspaceGrantId: null },
    ),
    /assignment changed/,
  );
  await assert.rejects(
    invoke("project_read_file", { ...scope, revision: 99, path: "app.js" }),
    /revision changed/,
  );
  await assert.rejects(
    invoke("project_start_run", { ...scope, command: "test" }),
    /permission is not enabled/,
  );
  const other = await create();
  await assert.rejects(
    invoke("project_read_file", {
      ...scope,
      projectId: other.id,
      path: "app.js",
    }),
    /not authorized/,
  );
});

test("file and scene proposals remain unapplied until an exact owner review is applied", async () => {
  const p = await create(),
    binding = bindAgent("alice", p.id, "bot-alice", false);
  const scene = {
    objects: [
      {
        id: randomUUID(),
        name: "Agent-built prop",
        kind: "box",
        position: [0, 0.5, 0],
        rotation: [0, 30, 0],
        scale: [2, 1, 1],
        color: "#83ceff",
      },
    ],
  };
  const response = await invoke("project_propose_changes", {
    ...proposalArgs(p, binding),
    scene,
  });
  assert.equal(response.applied, false);
  let saved = (await (await request(projectsApi, "GET", `/${p.id}`)).json())
    .project;
  assert.equal(saved.revision, 1);
  assert.equal(saved.scene.objects.length, 0);
  const id = response.proposal.id,
    review = await reviewProposal("alice", id);
  assert.match(review.diff, /\+console.log\("proposed"\)/);
  assert.equal(review.sceneChanged, true);
  assert.equal(review.afterScene.objects[0].name, "Agent-built prop");
  assert.equal(
    (await request(collaborationApi, "GET", `/proposals/${id}`, "bob")).status,
    404,
  );
  assert.equal(
    (
      await request(
        collaborationApi,
        "POST",
        `/proposals/${id}/apply`,
        "alice",
        { reviewHash: "0".repeat(64) },
      )
    ).status,
    409,
  );
  const applied = await request(
    collaborationApi,
    "POST",
    `/proposals/${id}/apply`,
    "alice",
    { reviewHash: review.proposal.reviewHash },
  );
  assert.equal(applied.status, 200);
  saved = (await applied.json()).project;
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.scene, scene);
  assert.equal(
    saved.files.find((f: any) => f.path === "app.js").content,
    'console.log("proposed");\n',
  );
  assert.equal(proposalSummary("alice", id)!.state, "applied");
  assert.equal(proposalSummary("alice", id)!.appliedRevision, 2);
  assert.throws(
    () => applyProposal("alice", id, review.proposal.reviewHash),
    /already reviewed/,
  );
  const status = await invoke("project_proposal_status", {
    projectId: p.id,
    grantId: binding.grantId,
    proposalId: id,
  });
  assert.equal(status.proposal.state, "applied");
});

test("stale, malformed and no-op proposals cannot overwrite source", async () => {
  const p = await create(),
    binding = bindAgent("alice", p.id, "bot-alice", false);
  assert.throws(
    () =>
      propose(
        "alice",
        "bot-alice",
        proposalArgs(
          p,
          binding,
          p.files.find((f: any) => f.path === "app.js").content,
        ),
      ),
    /no changes/,
  );
  for (const path of [".git/config", "../outside"])
    assert.throws(() =>
      propose("alice", "bot-alice", {
        ...proposalArgs(p, binding),
        changes: [{ path, content: "invalid" }],
      }),
    );
  const proposal = propose("alice", "bot-alice", proposalArgs(p, binding));
  const { id, revision, updatedAt, ...doc } = p;
  doc.files[0].content += "manual edit";
  assert.equal(
    (await request(projectsApi, "PUT", `/${id}`, "alice", { ...doc, revision }))
      .status,
    200,
  );
  assert.equal(proposalSummary("alice", proposal.id)!.stale, true);
  assert.throws(
    () => applyProposal("alice", proposal.id, proposal.reviewHash),
    /stale/,
  );
  rejectProposal("alice", proposal.id);
  assert.equal(proposalSummary("alice", proposal.id)!.state, "rejected");
  assert.throws(
    () => propose("alice", "bot-alice", proposalArgs(p, binding)),
    /current project revision/,
  );
});

test("reassignment revokes proposals and prevents stale-grant access", async () => {
  const p = await create(),
    binding = bindAgent("alice", p.id, "bot-alice", false),
    proposal = propose("alice", "bot-alice", proposalArgs(p, binding));
  const other = await create(),
    replacement = bindAgent("alice", other.id, "bot-alice", true);
  assert.notEqual(replacement.grantId, binding.grantId);
  assert.equal(proposalSummary("alice", proposal.id)!.state, "revoked");
  await assert.rejects(
    invoke("project_read_scene", {
      projectId: p.id,
      grantId: binding.grantId,
      revision: 1,
    }),
    /assignment changed/,
  );
  await assert.rejects(
    invoke(
      "project_overview",
      {},
      {
        userId: "alice",
        botId: "bot-alice",
        workspaceGrantId: binding.grantId,
      },
    ),
    /assignment changed/,
  );
  assert.throws(
    () => applyProposal("alice", proposal.id, proposal.reviewHash),
    /already reviewed/,
  );
  unbindAgent("alice", other.id, "bot-alice");
  assert.equal(bindingFor("alice", "bot-alice"), null);
});

test("run authorization is checked again after asynchronous snapshot preparation", async () => {
  const p = await create(),
    binding = bindAgent("alice", p.id, "bot-alice", true);
  let calls = 0;
  const service = new RunService({
    readiness: async () => ({
      available: true,
      backend: "docker",
      reason: "Test double",
    }),
    cleanup: async () => true,
    execute: async () => {
      calls++;
      return { exitCode: 0, cleanupVerified: true };
    },
  });
  const { assertBinding } =
    await import("../server/src/workspace/collaboration.js");
  const run = await service.start("alice", p.id, 1, "test", () =>
    assertBinding("alice", "bot-alice", p.id, binding.grantId),
  );
  unbindAgent("alice", p.id, "bot-alice");
  const result = await service.wait(run.id);
  assert.equal(result!.state, "failed");
  assert.equal(calls, 0);
  await service.shutdown();
});

test("the MCP gateway routes authenticated project tools without model calls", async () => {
  const p = await create(),
    binding = bindAgent("alice", p.id, "bot-alice", false);
  const { mcpApi } = await import("../server/src/mcp.js");
  const { mcpToken } = await import("../server/src/engine.js");
  const call = (
    slug: string,
    token: string,
    args: unknown,
    name = "project_read_file",
  ) =>
    mcpApi.request(`http://localhost/${slug}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  const args = {
    projectId: p.id,
    grantId: binding.grantId,
    revision: 1,
    path: "app.js",
  };
  const response = await call("bot-alice", mcpToken("bot-alice"), args);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.isError, undefined);
  assert.match(JSON.parse(body.result.content[0].text).content, /clicks/);
  assert.equal(
    (await call("bot-alice", mcpToken("bot-bob"), args)).status,
    401,
  );
  const foreign = await (
    await call("bot-bob", mcpToken("bot-bob"), args)
  ).json();
  assert.equal(foreign.result.isError, true);
  assert.match(foreign.result.content[0].text, /not authorized/);
  const modeling = await (
    await call(
      "bot-alice",
      mcpToken("bot-alice"),
      {
        projectId: p.id,
        grantId: binding.grantId,
        revision: 1,
        summary: "MCP modeling proposal",
        operations: [
          {
            op: "add",
            id: randomUUID(),
            name: "MCP cube",
            kind: "editable-cube",
          },
        ],
      },
      "project_propose_scene_operations",
    )
  ).json();
  assert.equal(modeling.result.isError, undefined);
  assert.equal(JSON.parse(modeling.result.content[0].text).applied, false);
});

test("modeling tool creates an unapplied reviewable scene proposal and preserves source on apply", async () => {
  const p = await create(),
    b = bindAgent("alice", p.id, "bot-alice", false),
    id = randomUUID();
  const answer = await invoke(
    "project_propose_scene_operations",
    {
      projectId: p.id,
      grantId: b.grantId,
      revision: p.revision,
      summary: "Build an editable prop",
      operations: [
        { op: "add", id, name: "Agent prop", kind: "editable-cube" },
        { op: "extrude", id, face: 3, distance: 0.25 },
        { op: "inset", id, face: 3, ratio: 0.2 },
      ],
    },
    { userId: "alice", botId: "bot-alice", workspaceGrantId: b.grantId },
  );
  assert.equal(answer.applied, false);
  assert.equal(answer.proposal.state, "pending");
  const before = await (await request(projectsApi, "GET", `/${p.id}`)).json();
  assert.equal(before.project.scene.objects.length, 0);
  assert.equal(before.project.revision, 1);
  const reviewed = await reviewProposal("alice", answer.proposal.id);
  assert.equal(reviewed.sceneChanged, true);
  assert.equal(reviewed.afterScene.objects[0].mesh.vertices.length, 16);
  const applied = applyProposal(
    "alice",
    answer.proposal.id,
    reviewed.proposal.reviewHash,
  );
  assert.deepEqual(applied.files, p.files);
  assert.equal(applied.revision, 2);
  assert.equal(applied.scene.objects[0].mesh.faces.length, 14);
});

test("modeling tool refuses failed batches, stale revisions and changed assignments without creating proposals", async () => {
  const p = await create(),
    b = bindAgent("alice", p.id, "bot-alice", false),
    id = randomUUID();
  const args = {
    projectId: p.id,
    grantId: b.grantId,
    revision: 1,
    summary: "Invalid modeling",
    operations: [
      { op: "add", id, name: "Candidate", kind: "editable-cube" },
      { op: "extrude", id, face: 999, distance: 1 },
    ],
  };
  await assert.rejects(
    invoke("project_propose_scene_operations", args),
    /valid polygon face/,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT count(*) AS n FROM workspace_proposals WHERE project_id=?",
        )
        .get(p.id) as any
    ).n,
    0,
  );
  const valid = { ...args, operations: args.operations.slice(0, 1) };
  await assert.rejects(
    invoke("project_propose_scene_operations", { ...valid, revision: 99 }),
    /revision changed/,
  );
  await assert.rejects(
    invoke("project_propose_scene_operations", valid, {
      userId: "bob",
      botId: "bot-bob",
    }),
    /not authorized/,
  );
  bindAgent("alice", p.id, "bot-alice", false);
  await assert.rejects(
    invoke("project_propose_scene_operations", valid, {
      userId: "alice",
      botId: "bot-alice",
      workspaceGrantId: b.grantId,
    }),
    /assignment changed/,
  );
});
