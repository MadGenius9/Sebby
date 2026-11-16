import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Runner,
  RunOutcome,
  RunCommand,
} from "../server/src/workspace/docker-runner.js";
import type { ProjectDocument } from "../server/src/workspace/schema.js";
const exec = promisify(execFile);
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-runtime-test-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
process.env.SEBBY_RUNS_DIR = path.join(root, "runs");
const { db } = await import("../server/src/db.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { RunService, createRunsApi, readRun } =
  await import("../server/src/workspace/runs.js");
const { DockerRunner, dockerCreateArgs, BOOTSTRAP } =
  await import("../server/src/workspace/docker-runner.js");
const { snapshot, revisionDiff } =
  await import("../server/src/workspace/repository.js");
const { starter } = await import("../server/src/workspace/templates.js");
for (const id of ["alice", "bob"]) {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run(id, `${id}@example.test`, id, Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run(id, id, Date.now(), Date.now() + 600000);
}
const services: InstanceType<typeof RunService>[] = [];
after(async () => {
  await Promise.all(services.map((s) => s.shutdown()));
  db.close();
  rmSync(root, { recursive: true, force: true });
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
        name: "Web project",
        template: "web",
      })
    ).json()
  ).project;
const waitUntil = async (fn: () => boolean) => {
  const end = Date.now() + 10000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Timed out waiting for test state");
    await new Promise((r) => setTimeout(r, 10));
  }
};
class TestRunner implements Runner {
  calls = 0;
  ready = true;
  clean = true;
  mode: "success" | "failure" | "wait" | "flood" = "success";
  async readiness() {
    return {
      available: this.ready,
      backend: "docker" as const,
      reason: this.ready ? "Test double" : "Unavailable test double",
    };
  }
  async cleanup() {
    return this.clean;
  }
  async execute(
    _id: string,
    _doc: ProjectDocument,
    _command: RunCommand,
    signal: AbortSignal,
    output: (text: string) => void,
  ): Promise<RunOutcome> {
    this.calls++;
    output("Observed fixture output\n");
    if (this.mode === "flood") output("x".repeat(100000));
    if (this.mode === "wait" || this.mode === "flood")
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    return {
      exitCode: this.mode === "failure" ? 1 : 0,
      cleanupVerified: this.clean,
    };
  }
}
const service = (runner: Runner, timeout = 10000, limit = 64000) => {
  const s = new RunService(runner, timeout, limit);
  services.push(s);
  return s;
};

test("saved revisions produce real Git source diffs and isolated snapshot commits", async () => {
  const project = await create();
  assert.equal(project.files.length, 6);
  const { id, revision, updatedAt, ...doc } = project;
  const changed = {
    ...doc,
    files: doc.files.map((f: any) =>
      f.path === "app.js"
        ? { ...f, content: f.content + '\nconsole.log("updated");\n' }
        : f,
    ),
    scene: {
      objects: [
        {
          id: randomUUID(),
          name: "Box",
          kind: "box",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          color: "#123456",
        },
      ],
    },
  };
  assert.equal(
    (
      await request(projectsApi, "PUT", `/${id}`, "alice", {
        ...changed,
        revision,
      })
    ).status,
    200,
  );
  const history = await (
    await request(projectsApi, "GET", `/${id}/revisions`)
  ).json();
  assert.deepEqual(
    history.revisions.map((r: any) => r.revision),
    [2, 1],
  );
  const comparison = await (
    await request(projectsApi, "GET", `/${id}/diff?from=1&to=2`)
  ).json();
  assert.match(comparison.diff, /\+console.log\("updated"\)/);
  assert.equal(comparison.sceneChanged, true);
  assert.equal(
    (await request(projectsApi, "GET", `/${id}/diff?from=1&to=2`, "bob"))
      .status,
    404,
  );
  const snap = await snapshot(changed, randomUUID());
  assert.match(snap.commit, /^[0-9a-f]{40}$/);
  assert.match(snap.hash, /^[0-9a-f]{64}$/);
  assert.equal(
    await fs.readFile(path.join(snap.directory, "app.js"), "utf8"),
    changed.files.find((f: any) => f.path === "app.js").content,
  );
  const { stdout } = await exec("git", [
    "-C",
    snap.directory,
    "status",
    "--porcelain",
  ]);
  assert.equal(stdout, "");
});

test("project imports round trip and reject reserved, overlapping and case-colliding paths", async () => {
  const project = await create();
  const imported = await (
    await request(projectsApi, "POST", "/import", "alice", project)
  ).json();
  assert.notEqual(imported.project.id, project.id);
  assert.equal(imported.project.revision, 1);
  assert.deepEqual(imported.project.files, project.files);
  for (const paths of [
    [".git/config"],
    ["src/.GiT/hooks/post-checkout"],
    ["node_modules/bin"],
    ["a", "a-b", "a/b"],
    ["App.js", "app.js"],
  ]) {
    const invalid = {
      ...project,
      files: paths.map((p) => ({ path: p, content: "" })),
    };
    assert.equal(
      (await request(projectsApi, "POST", "/import", "alice", invalid)).status,
      400,
      paths.join(","),
    );
  }
});

test("preview bundles local classic scripts/styles, places CSP first, and excludes external scripts", async () => {
  const project = await create();
  const p = await (
    await request(projectsApi, "GET", `/${project.id}/preview`)
  ).json();
  assert.match(p.html, /Content-Security-Policy/);
  assert.match(p.html, /data:text\/javascript;base64,/);
  assert.match(p.html, /Made with Sebby/);
  assert.doesNotMatch(p.html, /href="style.css"/);
  assert.ok(
    p.html.indexOf("Content-Security-Policy") < p.html.indexOf("charset"),
  );
  const { buildPreview } = await import("../server/src/workspace/preview.js");
  const result = buildPreview(
    {
      name: "Unsafe",
      scene: { objects: [] },
      files: [
        {
          path: "index.html",
          content:
            '<base href="https://evil.test"><meta http-equiv="refresh" content="0;url=https://evil.test"><script src="https://evil.test/a.js"></script><iframe src="https://evil.test"></iframe><a href="https://evil.test">link</a>',
        },
      ],
    },
    "index.html",
  );
  assert.doesNotMatch(result.html, /https:\/\/evil.test/);
  assert.ok(result.warnings.length >= 3);
  assert.equal(
    (await request(projectsApi, "GET", `/${project.id}/preview`, "bob")).status,
    404,
  );
});

test("trusted web starter syntax and build recipe run independently of the Docker adapter", async () => {
  const doc = starter("Fixture", "web"),
    dir = await fs.mkdtemp(path.join(root, "trusted-fixture-"));
  for (const f of doc.files)
    await fs.writeFile(path.join(dir, f.path), f.content);
  await exec(process.execPath, ["--check", "app.js"], { cwd: dir });
  await exec(process.execPath, ["build.mjs"], { cwd: dir });
  assert.equal(
    await fs.readFile(path.join(dir, "dist/index.html"), "utf8"),
    doc.files.find((f) => f.path === "index.html")!.content,
  );
  const bootstrap = path.join(root, "bootstrap.mjs");
  await fs.writeFile(bootstrap, BOOTSTRAP);
  await exec(process.execPath, ["--check", bootstrap]);
});

test("Docker configuration fails closed and its create command has no host mounts or network", async () => {
  assert.equal(
    (await new DockerRunner("", "/missing/docker").readiness()).available,
    false,
  );
  const args = dockerCreateArgs(randomUUID(), "node@sha256:" + "a".repeat(64));
  for (const required of [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=128",
    "--memory=512m",
    "--cpus=1",
    "--pull=never",
    "--user=65532:65532",
  ])
    assert.ok(args.includes(required));
  assert.ok(
    !args.some(
      (a) =>
        a === "--mount" ||
        a === "--volume" ||
        a === "-v" ||
        a === "--privileged",
    ),
  );
  const driver = new TestRunner();
  driver.ready = false;
  const s = service(driver),
    project = await create();
  await assert.rejects(s.start("alice", project.id, 1, "test"), /Unavailable/);
  assert.equal(driver.calls, 0);
  for (const content of ['null', '[]', JSON.stringify({scripts:{test:'node --check app.js'},dependencies:{react:'*'}})]) {
    const broken = await create();
    const {id,revision,updatedAt,...document} = broken;
    document.files = document.files.map((f:any) => f.path === 'package.json' ? {...f,content} : f);
    assert.equal((await request(projectsApi,'PUT',`/${id}`,'alice',{...document,revision})).status,200);
    await assert.rejects(s.start('alice',id,2,'test'), (e:any) => e.status === 400);
  }

  assert.equal(
    (
      db
        .prepare("SELECT count(*) AS n FROM workspace_runs WHERE project_id=?")
        .get(project.id) as any
    ).n,
    0,
  );
});

test("run records retain actual results and enforce owner access, revision and command contracts", async () => {
  const driver = new TestRunner(),
    s = service(driver),
    app = createRunsApi(s),
    project = await create();
  assert.equal((await request(app, 'GET', '/runtime', '')).status, 401);
  const foreign = await app.request(`http://localhost/${project.id}/runs`, {method:'POST',headers:{cookie:'grokbot_session=alice','content-type':'application/json',origin:'https://other.example'},body:JSON.stringify({revision:1,command:'test'})});
  assert.equal(foreign.status,403);
  assert.equal((await request(app,'POST',`/${project.id}/runs`,'alice',{revision:1,command:'test',padding:'x'.repeat(17000)})).status,413);

  assert.equal(
    (
      await request(app, "POST", `/${project.id}/runs`, "bob", {
        revision: 1,
        command: "test",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app, "POST", `/${project.id}/runs`, "alice", {
        revision: 1,
        command: "shell",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app, "POST", `/${project.id}/runs`, "alice", {
        revision: 99,
        command: "test",
      })
    ).status,
    409,
  );
  const started = await request(app, "POST", `/${project.id}/runs`, "alice", {
    revision: 1,
    command: "test",
  });
  assert.equal(started.status, 202);
  const id = (await started.json()).run.id;
  const run = await s.wait(id);
  assert.equal(run!.state, "succeeded");
  assert.equal(run!.exitCode, 0);
  assert.match(run!.log, /Observed fixture/);
  assert.ok(run!.snapshotCommit);
  assert.ok(run!.snapshotHash);
  assert.equal((await request(app, "GET", `/runs/${id}`, "bob")).status, 404);
  assert.equal(
    (await request(app, "POST", `/runs/${id}/cancel`, "bob", {})).status,
    404,
  );
  const streamed = await request(app, "GET", `/runs/${id}/events`);
  assert.match(await streamed.text(), /event: run/);
  driver.mode = "failure";
  const failed = await s.start("alice", project.id, 1, "build");
  assert.equal((await s.wait(failed.id))!.state, "failed");
});

test("run cancellation, timeouts and output bounds finish with explicit states", async () => {
  const project = await create(),
    driver = new TestRunner();
  driver.mode = "wait";
  const s = service(driver);
  const run = await s.start("alice", project.id, 1, "test");
  await waitUntil(() => driver.calls === 1);
  await assert.rejects(s.start("alice", project.id, 1, "test"), /active run/);
  assert.equal(s.cancel(run.id)!.state, "stopping");
  assert.equal((await s.wait(run.id))!.state, "cancelled");
  const timedDriver = new TestRunner();
  timedDriver.mode = "wait";
  const timed = service(timedDriver, 20);
  const timedRun = await timed.start("alice", project.id, 1, "test");
  assert.equal((await timed.wait(timedRun.id))!.state, "timed_out");
  const floodDriver = new TestRunner();
  floodDriver.mode = "flood";
  const flood = service(floodDriver, 10000, 1000);
  const flooded = await flood.start("alice", project.id, 1, "test");
  const result = await flood.wait(flooded.id);
  assert.equal(result!.state, "output_limit");
  assert.equal(result!.log.length, 1000);
});

test("unverified cleanup blocks new runs and restart recovery records interrupted work", async () => {
  const project = await create(),
    driver = new TestRunner();
  driver.clean = false;
  const s = service(driver);
  const run = await s.start("alice", project.id, 1, "test");
  assert.equal((await s.wait(run.id))!.state, "cleanup_failed");
  await assert.rejects(
    s.start("alice", project.id, 1, "build"),
    /needs cleanup/,
  );
  driver.clean = true;
  await s.recover();
  assert.equal(readRun(run.id)!.state, "interrupted");
  const id = randomUUID();
  db.prepare(
    "INSERT INTO workspace_runs(id,project_id,revision,command,state,created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, project.id, 1, "test", "running", Date.now());
  await s.recover();
  assert.equal(readRun(id)!.state, "interrupted");
});
