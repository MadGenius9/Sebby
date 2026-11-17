import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Script } from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
const exec = promisify(execFile),
  root = mkdtempSync(path.join(os.tmpdir(), "sebby-output-test-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
process.env.SEBBY_RUNS_DIR = path.join(root, "runs");
const { db } = await import("../server/src/db.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { RunService } = await import("../server/src/workspace/runs.js");
const { DockerRunner, BOOTSTRAP } =
  await import("../server/src/workspace/docker-runner.js");
const { validateArtifacts, COLLECT_OUTPUT_SOURCE, ARTIFACT_LIMITS } =
  await import("../server/src/workspace/artifact-protocol.js");
const { artifactsApi } =
  await import("../server/src/workspace/artifact-api.js");
const { buildManifest, readBuildFiles } =
  await import("../server/src/workspace/artifacts.js");
const { compileBuildPreview } =
  await import("../server/src/workspace/artifact-preview.js");
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
        name: "Output project",
        template: "web",
      })
    ).json()
  ).project;
const rawFile = (path: string, content: string | Buffer) => {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    path,
    base64: data.toString("base64"),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
};
const fixture = () => ({
  version: 1,
  outputDirectory: "dist",
  files: [
    rawFile(
      "index.html",
      '<!doctype html><html><head><link rel="stylesheet" href="/assets/main.css"></head><body><div id="app"></div><script type="module" src="/assets/main.js"></script></body></html>',
    ),
    rawFile(
      "assets/main.js",
      'import {message} from "./message.js"; document.getElementById("app").textContent=message;',
    ),
    rawFile(
      "assets/message.js",
      'export const message="Compiled fixture works";',
    ),
    rawFile(
      "assets/main.css",
      "body{color:#123456;background-image:url(./pixel.png)}",
    ),
    rawFile("assets/pixel.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  ],
});
const collect = async (directory: string, output = "dist") => {
  const { stdout } = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      COLLECT_OUTPUT_SOURCE +
        "\nconsole.log(JSON.stringify(await collectOutput(process.argv[1],process.argv[2])));",
      directory,
      output,
    ],
    { maxBuffer: ARTIFACT_LIMITS.transportBytes, timeout: 10000 },
  );
  return JSON.parse(stdout);
};
async function successfulRun(payload: unknown = fixture()) {
  const project = await create();
  const driver = {
    readiness: async () => ({
      available: true,
      backend: "docker" as const,
      reason: "Test double",
    }),
    cleanup: async () => true,
    execute: async () => ({
      exitCode: 0,
      cleanupVerified: true,
      artifacts: payload,
    }),
  };
  const service = new RunService(driver);
  services.push(service);
  const run = await service.start("alice", project.id, 1, "build");
  return { project, run: (await service.wait(run.id))!, service };
}

test("collector preserves bounded regular files and returns an explicit empty output set", async () => {
  const directory = await fs.mkdtemp(path.join(root, "collector-"));
  await fs.mkdir(path.join(directory, "dist/assets"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "dist/index.html"),
    "<h1>Collected</h1>",
  );
  await fs.writeFile(
    path.join(directory, "dist/assets/data.bin"),
    Buffer.from([0, 255, 1]),
  );
  const outputs = validateArtifacts(await collect(directory));
  assert.equal(outputs.files.length, 2);
  assert.deepEqual(
    outputs.files.find((f) => f.path === "assets/data.bin")!.data,
    Buffer.from([0, 255, 1]),
  );
  assert.deepEqual((await collect(directory, "absent")).files, []);
});

test("collector refuses links, traversal and size overruns without extracting archives", async () => {
  const directory = await fs.mkdtemp(path.join(root, "collector-bounds-"));
  await fs.mkdir(path.join(directory, "dist"));
  await fs.writeFile(path.join(directory, "outside.txt"), "not an output");
  await fs.symlink("../outside.txt", path.join(directory, "dist/link"));
  await assert.rejects(collect(directory), /links/);
  await fs.unlink(path.join(directory, "dist/link"));
  await fs.link(
    path.join(directory, "outside.txt"),
    path.join(directory, "dist/hard"),
  );
  await assert.rejects(collect(directory), /regular file/);
  await fs.unlink(path.join(directory, "dist/hard"));
  await fs.writeFile(
    path.join(directory, "dist/huge"),
    Buffer.alloc(ARTIFACT_LIMITS.fileBytes + 1),
  );
  await assert.rejects(collect(directory), /size limits/);
  await fs.unlink(path.join(directory, "dist/huge"));
  await assert.rejects(
    collect(directory, "../escape"),
    /Invalid output directory/,
  );
});

test("host validation rejects malformed, colliding, tampered and oversized outputs", () => {
  for (const invalid of [
    "../file",
    "/absolute",
    "a\\b",
    "a/../../outside",
    "CON.txt",
    "assets/AUX",
    "dir/end.",
    "trail ",
  ])
    assert.throws(() =>
      validateArtifacts({
        version: 1,
        outputDirectory: "dist",
        files: [rawFile(invalid, "bad")],
      }),
    );
  assert.throws(
    () =>
      validateArtifacts({
        version: 1,
        outputDirectory: "dist",
        files: [rawFile("A.js", "a"), rawFile("a.js", "b")],
      }),
    /collide/,
  );
  assert.throws(
    () =>
      validateArtifacts({
        version: 1,
        outputDirectory: "dist",
        files: [rawFile("a", "a"), rawFile("a/b", "b")],
      }),
    /collide/,
  );
  assert.throws(
    () =>
      validateArtifacts({
        version: 1,
        outputDirectory: "dist",
        files: [{ ...rawFile("a", "a"), sha256: "0".repeat(64) }],
      }),
    /hash/,
  );
  assert.throws(
    () =>
      validateArtifacts({
        version: 1,
        outputDirectory: "dist",
        files: [{ path: "a", base64: "%%%bad", sha256: "a".repeat(64) }],
      }),
    /encoding/,
  );
  assert.throws(() =>
    validateArtifacts({
      version: 1,
      outputDirectory: "dist",
      files: [rawFile("huge", Buffer.alloc(ARTIFACT_LIMITS.fileBytes + 1))],
    }),
  );
  assert.throws(
    () =>
      validateArtifacts({
        version: 1,
        outputDirectory: "dist",
        files: Array.from({ length: 5 }, (_, i) =>
          rawFile(`file${i}`, Buffer.alloc(ARTIFACT_LIMITS.fileBytes)),
        ),
      }),
    /total size/,
  );
});

test("successful outputs retain revision provenance and owner-scoped ZIP/file downloads", async () => {
  const { project, run } = await successfulRun();
  assert.equal(run.state, "succeeded");
  assert.equal(run.artifactState, "ready");
  const manifest = buildManifest("alice", run.id)!;
  assert.equal(manifest.revision, 1);
  assert.equal(manifest.files.length, 5);
  assert.equal(manifest.previewVerified, false);
  assert.equal(manifest.previewCandidate, true);
  for (const suffix of [
    "outputs",
    "outputs.zip",
    "output-file?path=index.html",
    "build-preview",
  ])
    assert.equal(
      (await request(artifactsApi, "GET", `/runs/${run.id}/${suffix}`, "bob"))
        .status,
      404,
    );
  const downloaded = await request(
    artifactsApi,
    "GET",
    `/runs/${run.id}/outputs.zip`,
  );
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get("content-disposition")!, /attachment/);
  assert.equal(
    downloaded.headers.get("x-sebby-manifest-sha256"),
    manifest.manifestHash,
  );
  const archive = unzipSync(new Uint8Array(await downloaded.arrayBuffer()));
  assert.match(
    Buffer.from(archive["index.html"]).toString(),
    /assets\/main.js/,
  );
  assert.deepEqual(
    Buffer.from(archive["assets/pixel.png"]),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const file = await request(
    artifactsApi,
    "GET",
    `/runs/${run.id}/output-file?path=index.html`,
  );
  assert.equal(file.headers.get("content-type"), "application/octet-stream");
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  const { id, revision, updatedAt, ...doc } = project;
  doc.files[0].content += "Later source edit";
  assert.equal(
    (await request(projectsApi, "PUT", `/${id}`, "alice", { ...doc, revision }))
      .status,
    200,
  );
  assert.equal(buildManifest("alice", run.id)!.revision, 1);
  db.prepare(
    "UPDATE workspace_build_files SET data=? WHERE run_id=? AND path=?",
  ).run(Buffer.from("corrupted"), run.id, "index.html");
  assert.throws(() => readBuildFiles("alice", run.id), /integrity/);
});

test("failed, invalid and cleanup-unverified runs never publish partial artifacts", async () => {
  for (const scenario of ["failed", "invalid", "cleanup"] as const) {
    const p = await create();
    let clean = scenario !== "cleanup";
    const driver = {
      readiness: async () => ({
        available: true,
        backend: "docker" as const,
        reason: "Test double",
      }),
      cleanup: async () => clean,
      execute: async () => ({
        exitCode: scenario === "failed" ? 1 : 0,
        cleanupVerified: clean,
        artifacts:
          scenario === "invalid"
            ? {
                ...fixture(),
                files: [{ ...rawFile("x", "x"), sha256: "0".repeat(64) }],
              }
            : fixture(),
      }),
    };
    const service = new RunService(driver);
    services.push(service);
    const started = await service.start("alice", p.id, 1, "build"),
      run = (await service.wait(started.id))!;
    assert.notEqual(run.state, "succeeded");
    assert.equal(run.artifactState, "withheld");
    assert.equal(buildManifest("alice", run.id), null);
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM workspace_builds WHERE run_id=?")
          .get(run.id) as any
      ).n,
      0,
    );
    clean = true;
    await service.recover();
  }
  const cancelledProject = await create();
  let entered = false;
  const cancelledService = new RunService({
    readiness: async () => ({
      available: true,
      backend: "docker",
      reason: "Test double",
    }),
    cleanup: async () => true,
    execute: async (_id, _doc, _cmd, signal) => {
      entered = true;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { exitCode: 0, cleanupVerified: true, artifacts: fixture() };
    },
  });
  services.push(cancelledService);
  const cancelled = await cancelledService.start(
    "alice",
    cancelledProject.id,
    1,
    "build",
  );
  while (!entered) await new Promise((r) => setTimeout(r, 10));
  cancelledService.cancel(cancelled.id);
  const cancelledResult = (await cancelledService.wait(cancelled.id))!;
  assert.equal(cancelledResult.state, "cancelled");
  assert.equal(cancelledResult.artifactState, "withheld");
  assert.equal(buildManifest("alice", cancelled.id), null);
  const { run } = await successfulRun({
    version: 1,
    outputDirectory: "dist",
    files: [],
  });
  assert.equal(run.state, "succeeded");
  assert.equal(run.artifactState, "absent");
  assert.equal(buildManifest("alice", run.id), null);
});

test("saved compiled module previews resolve only retained files and remain unverified", async () => {
  const { run } = await successfulRun();
  const response = await request(
    artifactsApi,
    "GET",
    `/runs/${run.id}/build-preview`,
  );
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.previewVerified, false);
  assert.equal(preview.revision, 1);
  assert.match(preview.html, /Content-Security-Policy/);
  assert.match(preview.html, /Compiled fixture works/);
  assert.match(preview.html, /data:image\/png/);
  assert.doesNotMatch(preview.html, /<script[^>]+src=/);
  const scripts = [...preview.html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const app = { textContent: "" };
  new Script(scripts[0][1]).runInNewContext({
    document: { getElementById: () => app },
  });
  assert.equal(app.textContent, "Compiled fixture works");
  const invalid = validateArtifacts({
    ...fixture(),
    files: [
      rawFile("index.html", '<script type="module" src="app.js"></script>'),
      rawFile("app.js", 'import "file:///etc/passwd";'),
    ],
  });
  await assert.rejects(
    compileBuildPreview(invalid.files),
    /External resources/,
  );
  const collision = validateArtifacts({version:1,outputDirectory:'dist',files:[rawFile('index.html','<script type="module">import {message} from "./__inline_0.js"; console.log(message);</script>'),rawFile('__inline_0.js','export const message="Inline name collision handled";')]});
  assert.match((await compileBuildPreview(collision.files)).html,/Inline name collision handled/);
  const importMeta = validateArtifacts({
    version: 1,
    outputDirectory: "dist",
    files: [
      rawFile("index.html", '<script type="module" src="app.js"></script>'),
      rawFile("app.js", "console.log(import.meta.url);"),
    ],
  });
  await assert.rejects(compileBuildPreview(importMeta.files), /import.meta/);
});

test("a trusted React/Vite fixture can be built and prepared without claiming Docker or browser validation", async () => {
  const directory = await fs.mkdtemp(path.join(root, "react-fixture-"));
  await fs.symlink(
    path.resolve("node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  await fs.writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  await fs.writeFile(
    path.join(directory, "index.html"),
    '<!doctype html><div id="root"></div><script type="module" src="/src.jsx"></script>',
  );
  await fs.writeFile(
    path.join(directory, "src.jsx"),
    'import React from "react";import {createRoot} from "react-dom/client";import "./style.css";createRoot(document.getElementById("root")).render(<button>Trusted React fixture</button>);',
  );
  await fs.writeFile(
    path.join(directory, "style.css"),
    "button { color: royalblue; }",
  );
  const require = createRequire(
    new URL("../web/package.json", import.meta.url),
  );
  const { build } = await import(pathToFileURL(require.resolve("vite")).href);
  await build({
    configFile: false,
    root: directory,
    base: "./",
    logLevel: "silent",
    build: { outDir: "dist", emptyOutDir: true, minify: false },
  });
  const artifacts = validateArtifacts(await collect(directory));
  const preview = await compileBuildPreview(artifacts.files);
  assert.match(preview.html, /Trusted React fixture/);
  assert.match(preview.html, /royalblue/);
  for (const script of preview.html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new Script(script[1]);
});

test("Docker attach keeps build transport separate from user-visible logs using a CLI fixture", async () => {
  const binary = path.join(root, "docker-fixture.cjs"),
    payload = fixture();
  await fs.writeFile(
    binary,
    '#!/usr/bin/env node\nconst command=process.argv[2];if(command==="info")console.log(JSON.stringify({SecurityOptions:["name=rootless"],CgroupVersion:"2",MemoryLimit:true,SwapLimit:true,PidsLimit:true,CPUCfsQuota:true}));else if(command==="create")console.log("fixture-container");else if(command==="start"){process.stdin.resume();process.stdin.on("end",()=>{process.stderr.write("fixture build log\\n");process.stdout.write(' +
      JSON.stringify(JSON.stringify(payload)) +
      ");});}\n",
    { mode: 0o700 },
  );
  const driver = new DockerRunner("node@sha256:" + "a".repeat(64), binary);
  assert.equal((await driver.readiness()).available, true);
  const p = await create();
  let log = "";
  const result = await driver.execute(
    randomUUID(),
    p,
    "build",
    new AbortController().signal,
    (text) => {
      log += text;
    },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.cleanupVerified, true);
  assert.deepEqual(result.artifacts, payload);
  assert.equal(log, "fixture build log\n");
  assert.ok(!log.includes("base64"));
  const file = path.join(root, "bootstrap.mjs");
  await fs.writeFile(file, BOOTSTRAP);
  await exec(process.execPath, ["--check", file]);
});
