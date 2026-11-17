// Operator acceptance: explicitly provisions a trusted disposable image/registry.
// User projects never invoke this script or gain a host execution fallback.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DockerRunner } from "../server/src/workspace/docker-runner.js";
import { documentSchema } from "../server/src/workspace/schema.js";
import { dependencyFingerprint } from "../server/src/workspace/dependencies.js";
import { validateArtifacts } from "../server/src/workspace/artifact-protocol.js";
const exec = promisify(execFile),
  docker = process.env.SEBBY_DOCKER_BIN || "/usr/bin/docker",
  base = process.env.SEBBY_RUNNER_IMAGE || "";
const readiness = await new DockerRunner(base, docker).readiness();
assert.equal(readiness.available, true, readiness.reason);
const root = await mkdtemp(path.join(os.tmpdir(), "sebby-dependency-live-")),
  registry = "sebby-fixture-registry-" + randomUUID();
const registryHost = "127.0.0.1:" + (30000 + Math.floor(Math.random() * 20000)),
  tag = registryHost + "/sebby-react-fixture:test";
let registryStarted = false,
  image: string | undefined;
const call = async (binary: string, args: string[], cwd?: string) =>
  (await exec(binary, args, { cwd, timeout: 180000, maxBuffer: 3000000 }))
    .stdout;
try {
  const source = path.join(root, "source");
  await mkdir(source);
  const pkg = {
    name: "sebby-react-worker-fixture",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: { build: "vite build", test: "node verify.mjs" },
    dependencies: { react: "18.3.1", "react-dom": "18.3.1" },
    devDependencies: { vite: "8.3.6" },
  };
  await writeFile(path.join(source, "package.json"), JSON.stringify(pkg));
  // This creates only a lockfile. Installation is restricted to the image build below.
  await call(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(root, "npm-cache"),
    ],
    source,
  );
  const lock = JSON.stringify(
    JSON.parse(await readFile(path.join(source, "package-lock.json"), "utf8")),
  );
  const document = documentSchema.parse({
    name: "Real React worker fixture",
    scene: { objects: [] },
    files: [
      { path: "package.json", content: JSON.stringify(pkg) },
      { path: "package-lock.json", content: lock },
      {
        path: "index.html",
        content:
          '<!doctype html><div id="root"></div><script type="module" src="./src.jsx"></script>',
      },
      {
        path: "src.jsx",
        content:
          'import React from "react";import {createRoot} from "react-dom/client";createRoot(document.getElementById("root")).render(<button>React worker fixture</button>);',
      },
      {
        path: "verify.mjs",
        content: `import assert from 'node:assert/strict';import fs from 'node:fs/promises';import React from 'react';import{renderToString}from'react-dom/server';assert.equal(renderToString(React.createElement('h1',null,'React worker fixture')),'<h1>React worker fixture</h1>');assert.equal(await fs.readlink('/workspace/node_modules'),'/opt/sebby/node_modules');await assert.rejects(fs.writeFile('/opt/sebby/node_modules/sebby-write-test','blocked'));console.log('Real dependency imports and read-only tree passed');`,
      },
    ],
  });
  const exportPath = path.join(root, "project.json"),
    context = path.join(root, "context");
  await writeFile(exportPath, JSON.stringify(document));
  await call(process.execPath, [
    "--import",
    "tsx",
    "scripts/prepare-dependencies.mts",
    exportPath,
    context,
  ]);
  await call(docker, ["pull", "registry:3"]);
  const registryImage = JSON.parse(
    await call(docker, ["image", "inspect", "registry:3"]),
  )[0].RepoDigests[0];
  // The rootless daemon and this registry share their private network namespace.
  await call(docker, [
    "run",
    "--detach",
    "--name",
    registry,
    "--network=host",
    "--env",
    "REGISTRY_HTTP_ADDR=" + registryHost,
    registryImage,
  ]);
  registryStarted = true;
  await call(docker, [
    "build",
    "--build-arg",
    "NODE_IMAGE=" + base,
    "--tag",
    tag,
    context,
  ]);
  await call(docker, ["push", tag]);
  image = JSON.parse(
    await call(docker, ["image", "inspect", tag]),
  )[0].RepoDigests.find((name: string) =>
    name.startsWith(registryHost + "/sebby-react-fixture@sha256:"),
  );
  assert.ok(image, "Provisioned image must have a repository digest");
  const lockHash = dependencyFingerprint(document)!;
  const runner = new DockerRunner(
    base,
    docker,
    JSON.stringify([{ lockHash, image }]),
  );
  assert.equal((await runner.readiness(document)).available, true);
  let log = "";
  const execute = (
    doc: typeof document,
    command: "build" | "test",
    selected = runner,
  ) =>
    selected.execute(
      randomUUID(),
      doc,
      command,
      AbortSignal.timeout(90000),
      (text) => {
        log += text;
      },
    );
  const build = await execute(document, "build");
  assert.equal(build.exitCode, 0, log + "\n" + build.error);
  assert.equal(build.cleanupVerified, true);
  const outputs = validateArtifacts(build.artifacts);
  assert.ok(outputs.files.some((f) => f.path === "index.html"));
  assert.ok(
    outputs.files.some(
      (f) =>
        f.path.endsWith(".js") &&
        f.data.toString().includes("React worker fixture"),
    ),
  );
  const tested = await execute(document, "test");
  assert.equal(tested.exitCode, 0, log);
  assert.equal(tested.cleanupVerified, true);
  assert.match(log, /Real dependency imports and read-only tree passed/);
  // A catalog mistake must be detected in the guest before the project command executes.
  const mismatch = structuredClone(document);
  mismatch.files[1].content += "\n";
  const mismatchedRunner = new DockerRunner(
    base,
    docker,
    JSON.stringify([{ lockHash: dependencyFingerprint(mismatch), image }]),
  );
  log = "";
  const refused = await execute(mismatch, "test", mismatchedRunner);
  assert.notEqual(refused.exitCode, 0);
  assert.equal(refused.cleanupVerified, true);
  assert.match(log, /Dependency image lockfile does not match/);
  assert.doesNotMatch(log, /Real dependency imports and read-only tree passed/);
  const failing = structuredClone(document);
  failing.files.find((f) => f.path === "verify.mjs")!.content =
    "throw new Error('EXPECTED_DEPENDENCY_TEST_FAILURE')";
  log = "";
  const failure = await execute(failing, "test");
  assert.notEqual(failure.exitCode, 0);
  assert.equal(failure.cleanupVerified, true);
  assert.match(log, /EXPECTED_DEPENDENCY_TEST_FAILURE/);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "real React/Vite build in no-network container",
          "retained compiled outputs",
          "React SSR test",
          "read-only dependency tree",
          "guest lock mismatch refusal",
          "dependency test failure and cleanup",
        ],
        image,
        lockHash,
        outputFiles: outputs.files.map((f) => f.path),
      },
      null,
      2,
    ),
  );
} finally {
  if (registryStarted) await call(docker, ["rm", "--force", registry]);
  if (image)
    await call(docker, ["image", "rm", "--force", tag]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
