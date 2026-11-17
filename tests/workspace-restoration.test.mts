import { execFileSync } from "node:child_process";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-restoration-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { projectsApi: app } =
  await import("../server/src/workspace/projects.js");
const { db } = await import("../server/src/db.js");
const { reviewRestoration, applyRestoration } =
  await import("../server/src/workspace/restoration.js");
const { rememberRevision, revisionDocument, snapshot } =
  await import("../server/src/workspace/repository.js");
const { bindAgent, propose, reviewProposal, applyProposal } =
  await import("../server/src/workspace/collaboration.js");
await import("../server/src/workspace/runs.js");
for (const id of ["alice", "bob"]) {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run(id, `${id}@example.test`, id, Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run(id, id, Date.now(), Date.now() + 600000);
  db.prepare(
    "INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)",
  ).run("bot-" + id, id, id, Date.now(), Date.now());
}
after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
const doc = (name = "Original project", text = "<h1>Original source</h1>") => ({
  name,
  files: [
    { path: "index.html", content: text },
    {
      path: "SEBBY.md",
      content: "# Requirements\nKeep original requirements.",
    },
  ],
  scene: {
    objects: [
      {
        id: randomUUID(),
        name: "Original box",
        kind: "box",
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#83ceff",
      },
    ],
  },
});
const request = (
  method: string,
  url: string,
  body?: unknown,
  user = "alice",
  origin = "http://localhost",
) =>
  app.request("http://localhost" + url, {
    method,
    headers: {
      cookie: `grokbot_session=${user}`,
      "content-type": "application/json",
      origin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function setup() {
  const original = doc();
  const project = (await (await request("POST", "/import", original)).json())
    .project;
  const edited = {
    name: "Renamed project",
    files: [
      { path: "index.html", content: "<h1>Edited source</h1>" },
      { path: "new.js", content: 'console.log("added later")' },
    ],
    scene: { objects: [] },
  };
  assert.equal(
    (await request("PUT", "/" + project.id, { ...edited, revision: 1 })).status,
    200,
  );
  return { id: project.id, original, edited };
}
async function review(id: string) {
  const result = await request(
    "GET",
    `/${id}/restore-review?revision=2&target=1`,
  );
  assert.equal(result.status, 200);
  return result.json();
}
const apply = (id: string, r: any, user = "alice") =>
  request(
    "POST",
    "/" + id + "/restore",
    {
      revision: r.baseRevision,
      targetRevision: r.targetRevision,
      reviewHash: r.reviewHash,
    },
    user,
  );

test("reviewed restoration creates a new revision and preserves source, name, scene, notes and history", async () => {
  const { id, original, edited } = await setup(),
    r = await review(id);
  assert.equal(r.sceneChanged, true);
  assert.equal(r.nameChanged, true);
  assert.match(r.diff, /\+<h1>Original source/);
  assert.match(r.diff, /-<h1>Edited source/);
  assert.deepEqual(r.afterScene, original.scene);
  assert.deepEqual(revisionDocument(id, 2), edited);
  const restored = await apply(id, r);
  assert.equal(restored.status, 200);
  const project = (await restored.json()).project;
  assert.equal(project.id, id);
  assert.equal(project.revision, 3);
  assert.deepEqual(
    { name: project.name, files: project.files, scene: project.scene },
    original,
  );
  assert.deepEqual(revisionDocument(id, 1), original);
  assert.deepEqual(revisionDocument(id, 2), edited);
  assert.deepEqual(revisionDocument(id, 3), original);
  const history = (await (await request("GET", `/${id}/revisions`)).json())
    .revisions;
  assert.deepEqual(
    history.map((r: any) => [r.revision, r.restoredFrom]),
    [
      [3, 1],
      [2, null],
      [1, null],
    ],
  );
  const audit = db
    .prepare("SELECT * FROM workspace_restores WHERE project_id=?")
    .get(id) as any;
  assert.equal(audit.source_revision, 1);
  assert.equal(audit.base_revision, 2);
  assert.equal(audit.user_id, "alice");
  assert.equal(audit.review_hash, r.reviewHash);
  const preview = await (await request("GET", `/${id}/preview`)).json();
  assert.match(preview.html, /Original source/);
  assert.equal(preview.revision, 3);
});

test("restoration requires the owning session, same origin, saved revisions and an exact review", async () => {
  const { id } = await setup(),
    r = await review(id);
  assert.equal(
    (
      await request(
        "GET",
        `/${id}/restore-review?revision=2&target=1`,
        undefined,
        "missing",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/${id}/restore-review?revision=2&target=1`,
        undefined,
        "bob",
      )
    ).status,
    404,
  );
  assert.equal((await apply(id, r, "bob")).status, 404);
  assert.equal(
    (
      await request(
        "POST",
        "/" + id + "/restore",
        { revision: 2, targetRevision: 1, reviewHash: r.reviewHash },
        "alice",
        "https://other.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("POST", "/" + id + "/restore", {
        revision: 2,
        targetRevision: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (await apply(id, { ...r, reviewHash: "0".repeat(64) })).status,
    409,
  );
  for (const target of ["0", "1.5", "2", "3", "NaN"])
    assert.notEqual(
      (
        await request(
          "GET",
          `/${id}/restore-review?revision=2&target=${target}`,
        )
      ).status,
      200,
    );
  const other = await setup();
  assert.equal((await apply(other.id, r)).status, 409);
  assert.equal(
    (await (await request("GET", "/" + id)).json()).project.revision,
    2,
  );
});

test("stale heads, changed historical data, replay and no-op restorations are refused", async () => {
  const first = await setup(),
    r = await review(first.id);
  await request("PUT", "/" + first.id, {
    ...first.edited,
    name: "Concurrent edit",
    revision: 2,
  });
  assert.equal((await apply(first.id, r)).status, 409);
  const second = await setup(),
    old = await review(second.id);
  db.prepare(
    "UPDATE workspace_revisions SET document=? WHERE project_id=? AND revision=1",
  ).run(
    JSON.stringify({ ...second.original, name: "Changed history fixture" }),
    second.id,
  );
  assert.equal((await apply(second.id, old)).status, 409);
  const third = await setup(),
    ready = await review(third.id);
  assert.equal((await apply(third.id, ready)).status, 200);
  assert.equal((await apply(third.id, ready)).status, 409);
  assert.equal(
    (await request("GET", `/${third.id}/restore-review?revision=3&target=1`))
      .status,
    409,
  );
});

test("restoration history and the project update roll back together if audit persistence fails", async () => {
  const { id, edited } = await setup(),
    r = await review(id);
  db.exec(
    "CREATE TRIGGER fail_restore_audit BEFORE INSERT ON workspace_restores BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
  );
  try {
    assert.equal((await apply(id, r)).status, 503);
    const current = (await (await request("GET", "/" + id)).json()).project;
    assert.equal(current.revision, 2);
    assert.deepEqual(current.files, edited.files);
    assert.equal(revisionDocument(id, 3), null);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM workspace_restores WHERE project_id=?",
          )
          .get(id) as any
      ).n,
      0,
    );
  } finally {
    db.exec("DROP TRIGGER fail_restore_audit");
  }
  assert.equal((await apply(id, r)).status, 200);
});

test("restoring makes old agent proposals stale, retains run provenance and can itself be reversed", async () => {
  const { id, edited } = await setup(),
    binding = bindAgent("alice", id, "bot-alice", false);
  const proposal = propose("alice", "bot-alice", {
    projectId: id,
    grantId: binding.grantId,
    revision: 2,
    summary: "Pending edit before restoration",
    changes: [{ path: "index.html", content: "<h1>Pending agent edit</h1>" }],
  });
  const runId = randomUUID();
  db.prepare(
    "INSERT INTO workspace_runs(id,project_id,revision,command,state,created_at) VALUES(?,?,2,'build','succeeded',?)",
  ).run(runId, id, Date.now());
  const reviewed = await reviewProposal("alice", proposal.id),
    r = await review(id);
  assert.equal((await apply(id, r)).status, 200);
  await assert.rejects(
    async () =>
      applyProposal("alice", proposal.id, reviewed.proposal.reviewHash),
    /changed|stale/i,
  );
  assert.equal(
    (
      db
        .prepare("SELECT revision FROM workspace_runs WHERE id=?")
        .get(runId) as any
    ).revision,
    2,
  );
  const back = await reviewRestoration("alice", id, 3, 2),
    project = applyRestoration("alice", id, 3, 2, back.reviewHash);
  assert.equal(project.revision, 4);
  assert.deepEqual(
    { name: project.name, files: project.files, scene: project.scene },
    edited,
  );
  assert.equal(
    (await (await request("GET", `/${id}/revisions`)).json()).revisions[0]
      .restoredFrom,
    2,
  );
});

test("an edit during Git diff preparation invalidates the preview rather than silently reviewing an old head", async () => {
  const { id, edited } = await setup();
  const pending = reviewRestoration("alice", id, 2, 1);
  db.transaction(() => {
    const changed = { ...edited, name: "Saved during review" };
    db.prepare(
      "UPDATE workspace_projects SET name=?,document=?,revision=3 WHERE id=?",
    ).run(changed.name, JSON.stringify(changed), id);
    rememberRevision(id, 3, changed);
  })();
  await assert.rejects(pending, /changed while preparing/);
});

test("older revisions remain restorable beyond the recent-history picker window", async () => {
  const { id, original, edited } = await setup();
  db.transaction(() => {
    for (let revision = 3; revision <= 105; revision++)
      rememberRevision(id, revision, edited);
    db.prepare("UPDATE workspace_projects SET revision=105 WHERE id=?").run(id);
  })();
  const recent = (await (await request("GET", `/${id}/revisions`)).json())
    .revisions;
  assert.equal(recent.length, 100);
  assert.ok(!recent.some((row: any) => row.revision === 1));
  const reviewed = await reviewRestoration("alice", id, 105, 1),
    restored = applyRestoration("alice", id, 105, 1, reviewed.reviewHash);
  assert.equal(restored.revision, 106);
  assert.deepEqual(restored.scene, original.scene);
  assert.deepEqual(revisionDocument(id, 2), edited);
});

test("project attributes cannot hide source text from a restoration review", async () => {
  const first = {
    name: "Attribute fixture",
    files: [
      { path: ".gitattributes", content: "*.js -diff\n" },
      { path: "app.js", content: 'console.log("original behavior");\n' },
    ],
    scene: { objects: [] },
  };
  const created = (await (await request("POST", "/import", first)).json())
    .project;
  const changed = {
    ...first,
    files: first.files.map((file) =>
      file.path === "app.js"
        ? { ...file, content: 'console.log("changed behavior");\n' }
        : file,
    ),
  };
  await request("PUT", "/" + created.id, { ...changed, revision: 1 });
  const reviewed = await reviewRestoration("alice", created.id, 2, 1);
  assert.match(reviewed.diff, /\+console.log\("original behavior"\)/);
  assert.match(reviewed.diff, /-console.log\("changed behavior"\)/);
});

test("private Git snapshots preserve source bytes despite project normalization attributes", async () => {
  const { snapshot } = await import("../server/src/workspace/repository.js");
  const source = {
    name: "Raw source bytes",
    files: [
      { path: ".gitattributes", content: "*.js text eol=lf\n" },
      { path: "app.js", content: 'console.log("CRLF preserved");\r\n' },
    ],
    scene: { objects: [] },
  };
  const saved = await snapshot(source, randomUUID());
  const bytes = execFileSync("git", ["show", "HEAD:app.js"], {
    cwd: saved.directory,
  });
  assert.deepEqual(bytes, Buffer.from(source.files[1].content));
  const { documentSchema } = await import("../server/src/workspace/schema.js");
  for (const path of [".git./config", "CON.js", "src/nul.txt", "trailing."])
    assert.equal(
      documentSchema.safeParse({
        ...source,
        files: [{ path, content: "refused" }],
      }).success,
      false,
      path,
    );
});
