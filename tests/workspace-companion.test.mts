import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { localTask, allowedSource } from "../scripts/companion-files.mjs";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-companion-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { db } = await import("../server/src/db.js");
const { companionApi: app } =
  await import("../server/src/workspace/companion.js");
for (const id of ["alice", "bob"]) {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run(id, `${id}@example.test`, id, Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run(id, id, Date.now(), Date.now() + 600000);
}
after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
const call = (
  url: string,
  method = "GET",
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
const device = (url: string, token: string, body: unknown = {}) =>
  app.request("http://localhost/device" + url, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
async function pair(writable = false) {
  const created = await call("/pairing", "POST", {});
  const { code } = await created.json();
  const paired = await device("/pair", "", {
    code,
    label: "Fixture computer",
    rootName: "Selected source",
    writable,
  });
  assert.equal(paired.status, 201);
  return { code, ...(await paired.json()) };
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("companion pairing is owner-bound, single-use and stores only hashed credentials", async () => {
  assert.equal((await call("/pairing", "POST", {}, "missing")).status, 401);
  assert.equal(
    (await call("/pairing", "POST", {}, "alice", "https://other.test")).status,
    403,
  );
  const paired = await pair();
  assert.equal(
    (
      await device("/pair", "", {
        code: paired.code,
        label: "Replay",
        rootName: "Nope",
        writable: false,
      })
    ).status,
    403,
  );
  const row = db
    .prepare("SELECT * FROM workspace_companions WHERE id=?")
    .get(paired.id) as any;
  assert.equal(row.token_hash, hash(paired.token));
  assert.ok(!JSON.stringify(row).includes(paired.token));
  const listed = await (await call("/")).json();
  assert.ok(listed.companions.some((d: any) => d.id === paired.id));
  assert.ok(
    !(await (await call("/", "GET", undefined, "bob")).json()).companions.some(
      (d: any) => d.id === paired.id,
    ),
  );
  assert.equal(
    (
      await call("/" + paired.id + "/jobs", "POST", {
        operation: "write",
        path: "app.js",
        content: "x",
        expectedHash: hash(""),
      })
    ).status,
    403,
  );
});

test("companion jobs enforce owners, device identity, result integrity, replay and revocation", async () => {
  const paired = await pair(true),
    other = await pair();
  assert.equal(
    (
      await call(
        "/" + paired.id + "/jobs",
        "POST",
        { operation: "read", path: "app.js" },
        "bob",
      )
    ).status,
    404,
  );
  const queued = await call("/" + paired.id + "/jobs", "POST", {
    operation: "read",
    path: "app.js",
  });
  assert.equal(queued.status, 202);
  const { id } = await queued.json();
  const polled = await device("/poll", paired.token);
  assert.deepEqual((await polled.json()).job, {
    id,
    operation: "read",
    path: "app.js",
  });
  assert.equal((await (await device("/poll", paired.token)).json()).job, null);
  assert.equal(
    (
      await device("/result/" + id, other.token, {
        ok: true,
        path: "app.js",
        content: "file",
        sha256: hash("file"),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await device("/result/" + id, paired.token, {
        ok: true,
        path: "app.js",
        content: "file",
        sha256: hash("wrong"),
      })
    ).status,
    400,
  );
  const result = {
    ok: true,
    path: "app.js",
    content: "file",
    sha256: hash("file"),
  };
  assert.equal(
    (await device("/result/" + id, paired.token, result)).status,
    200,
  );
  assert.equal(
    (await device("/result/" + id, paired.token, result)).status,
    409,
  );
  const completed = await (await call("/" + paired.id + "/jobs/" + id)).json();
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.result.content, "file");
  assert.equal(
    (await call("/" + paired.id + "/jobs/" + id, "GET", undefined, "bob"))
      .status,
    404,
  );
  await call("/" + paired.id + "/jobs", "POST", { operation: "list" });
  assert.equal(
    (await call("/" + paired.id + "/revoke", "POST", {})).status,
    200,
  );
  assert.equal((await device("/poll", paired.token)).status, 401);
  assert.equal(
    (await call("/" + paired.id + "/jobs", "POST", { operation: "list" }))
      .status,
    409,
  );
});

test("companion expiry and queue bounds refuse abandoned work and clear transient source payloads", async () => {
  const paired = await pair();
  let taskId = "";
  for (let i = 0; i < 5; i++) {
    const result = await call("/" + paired.id + "/jobs", "POST", {
      operation: "list",
    });
    assert.equal(result.status, 202);
    taskId = (await result.json()).id;
  }
  assert.equal(
    (await call("/" + paired.id + "/jobs", "POST", { operation: "list" }))
      .status,
    409,
  );
  db.prepare(
    "UPDATE workspace_companion_jobs SET created_at=? WHERE companion_id=?",
  ).run(Date.now() - 61000, paired.id);
  assert.equal((await (await device("/poll", paired.token)).json()).job, null);
  const task = await (await call("/" + paired.id + "/jobs/" + taskId)).json();
  assert.equal(task.state, "expired");
  db.prepare(
    "UPDATE workspace_companion_jobs SET finished_at=? WHERE id=?",
  ).run(Date.now() - 601000, taskId);
  await call("/");
  assert.equal(
    (
      db
        .prepare("SELECT request FROM workspace_companion_jobs WHERE id=?")
        .get(taskId) as any
    ).request,
    "{}",
  );
  db.prepare("UPDATE workspace_companions SET last_seen=? WHERE id=?").run(
    Date.now() - 16000,
    paired.id,
  );
  assert.equal(
    (await call("/" + paired.id + "/jobs", "POST", { operation: "list" }))
      .status,
    409,
  );
});

test("real companion file operations stay within source policy and back up reviewed writes", async () => {
  const selected = path.join(root, "selected"),
    outside = path.join(root, "outside"),
    backups = path.join(root, "backups");
  await fs.mkdir(selected);
  await fs.mkdir(outside);
  await fs.mkdir(path.join(selected, "src"));
  await fs.mkdir(path.join(selected, "node_modules"));
  await fs.writeFile(path.join(selected, "src", "app.js"), "original");
  await fs.writeFile(path.join(selected, ".env"), "SECRET=excluded");
  await fs.writeFile(path.join(selected, "node_modules", "pkg.js"), "excluded");
  await fs.writeFile(path.join(outside, "private.js"), "outside");
  await fs.symlink(
    path.join(outside, "private.js"),
    path.join(selected, "linked.js"),
  );
  const files = await localTask(selected, { operation: "list" });
  assert.deepEqual(files.files, ["src/app.js"]);
  for (const name of [
    "../outside/private.js",
    "/absolute.js",
    "src\\app.js",
    ".env",
    ".ssh/key.json",
    "node_modules/pkg.js",
    "CON.js",
  ])
    assert.equal(allowedSource(name), false);
  await assert.rejects(
    localTask(selected, { operation: "read", path: "linked.js" }),
    /Links/,
  );
  const read = await localTask(selected, {
    operation: "read",
    path: "src/app.js",
  });
  assert.equal(read.content, "original");
  await assert.rejects(
    localTask(selected, {
      operation: "write",
      path: "src/app.js",
      content: "new",
      expectedHash: read.sha256,
    }),
    /read-only/,
  );
  await assert.rejects(
    localTask(
      selected,
      {
        operation: "write",
        path: "src/app.js",
        content: "new",
        expectedHash: hash("stale"),
      },
      { writable: true, backupDirectory: backups },
    ),
    /changed/,
  );
  const write = await localTask(
    selected,
    {
      operation: "write",
      path: "src/app.js",
      content: "updated",
      expectedHash: read.sha256,
    },
    { writable: true, backupDirectory: backups },
  );
  assert.equal(write.sha256, hash("updated"));
  assert.equal(
    await fs.readFile(path.join(selected, "src", "app.js"), "utf8"),
    "updated",
  );
  const backup = JSON.parse(
    await fs.readFile(
      path.join(backups, (await fs.readdir(backups))[0]),
      "utf8",
    ),
  );
  assert.equal(backup.content, "original");
  await assert.rejects(
    localTask(
      selected,
      {
        operation: "write",
        path: "new.js",
        content: "new",
        expectedHash: null,
      },
      { writable: true, backupDirectory: backups },
    ),
    /existing reviewed/,
  );
  await fs.link(
    path.join(outside, "private.js"),
    path.join(selected, "hard.js"),
  );
  await assert.rejects(
    localTask(selected, { operation: "read", path: "hard.js" }),
    /Hard-linked/,
  );
  assert.equal(
    await fs.readFile(path.join(outside, "private.js"), "utf8"),
    "outside",
  );
});

test("broker and local companion complete a real read/write round trip without host command execution", async () => {
  const selected = path.join(root, "roundtrip"),
    backupDirectory = path.join(root, "roundtrip-backups");
  await fs.mkdir(selected);
  await fs.writeFile(path.join(selected, "app.js"), "before");
  const paired = await pair(true);
  async function execute(operation: any) {
    const queued = await (
      await call("/" + paired.id + "/jobs", "POST", operation)
    ).json();
    const { job } = await (await device("/poll", paired.token)).json();
    assert.equal(job.id, queued.id);
    const result = await localTask(selected, job, {
      writable: true,
      backupDirectory,
    });
    assert.equal(
      (await device("/result/" + job.id, paired.token, result)).status,
      200,
    );
    return (await (await call("/" + paired.id + "/jobs/" + job.id)).json())
      .result;
  }
  const read = await execute({ operation: "read", path: "app.js" });
  await execute({
    operation: "write",
    path: "app.js",
    content: "after",
    expectedHash: read.sha256,
  });
  assert.equal(
    await fs.readFile(path.join(selected, "app.js"), "utf8"),
    "after",
  );
  assert.equal(
    (
      await call("/" + paired.id + "/jobs", "POST", {
        operation: "shell",
        command: "anything",
      })
    ).status,
    400,
  );
  await assert.rejects(
    localTask(selected, { operation: "shell" }),
    /does not run commands/,
  );
});
