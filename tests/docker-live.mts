// Explicit opt-in: provisions nothing and requires an already configured rootless Docker worker.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET ||= randomUUID();
const { DockerRunner } =
  await import("../server/src/workspace/docker-runner.js");
const { starter } = await import("../server/src/workspace/templates.js");
const { validateArtifacts } =
  await import("../server/src/workspace/artifact-protocol.js");
const runner = new DockerRunner(),
  document = starter("Live isolated build", "web"),
  status = await runner.readiness(document);
assert.equal(status.available, true, status.reason);
let log = "";
const id = randomUUID(),
  controller = new AbortController(),
  timer = setTimeout(() => controller.abort(), 60000);
try {
  const result = await runner.execute(
    id,
    document,
    "build",
    controller.signal,
    (text) => (log += text),
  );
  assert.equal(result.error, undefined);
  assert.equal(result.exitCode, 0, log);
  assert.equal(result.cleanupVerified, true);
  const outputs = validateArtifacts(result.artifacts);
  assert.deepEqual(
    outputs.files.map((f) => f.path),
    ["app.js", "index.html", "style.css"],
  );
  assert.match(log, /Built index.html/);
  const test = await runner.execute(
    randomUUID(),
    document,
    "test",
    controller.signal,
    (text) => (log += text),
  );
  assert.equal(test.exitCode, 0, log);
  assert.equal(test.cleanupVerified, true);
  const isolation = structuredClone(document);
  isolation.files.find((f) => f.path === "package.json")!.content =
    JSON.stringify({
      name: "isolation-fixture",
      scripts: { test: "node isolation.mjs" },
    });
  isolation.files.push({
    path: "isolation.mjs",
    content: String.raw`import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';
 assert.equal(process.getuid(),65532);assert.equal(process.env.SEBBY_HOST_CANARY,undefined);
 const status=await fs.readFile('/proc/self/status','utf8');assert.match(status,/NoNewPrivs:\s+1/);assert.match(status,/CapEff:\s+0+\n/);
 assert.ok(Number(await fs.readFile('/sys/fs/cgroup/memory.max','utf8'))<=536870912);assert.ok(Number(await fs.readFile('/sys/fs/cgroup/pids.max','utf8'))<=128);
 const [quota,period]=(await fs.readFile('/sys/fs/cgroup/cpu.max','utf8')).trim().split(' ').map(Number);assert.ok(quota/period<=1);
 assert.deepEqual(Object.keys(os.networkInterfaces()).filter(name=>name!=='lo'),[]);
 await assert.rejects(fs.writeFile('/etc/sebby-should-not-write','blocked'));console.log('Isolation resource checks passed');`,
  });
  process.env.SEBBY_HOST_CANARY = "not-forwarded-test-value";
  const isolated = await runner.execute(
    randomUUID(),
    isolation,
    "test",
    controller.signal,
    (text) => (log += text),
  );
  assert.equal(isolated.exitCode, 0, log);
  assert.equal(isolated.cleanupVerified, true);

  const failure = structuredClone(document);
  failure.files.find((f) => f.path === "app.js")!.content = "function {";
  const failed = await runner.execute(
    randomUUID(),
    failure,
    "test",
    controller.signal,
    () => {},
  );
  assert.notEqual(failed.exitCode, 0);
  assert.equal(failed.cleanupVerified, true);
  const waiting = structuredClone(document);
  waiting.files.find((f) => f.path === "app.js")!.content =
    'console.log("CANCEL_READY");setInterval(()=>{},1000)';
  waiting.files.find((f) => f.path === "package.json")!.content =
    JSON.stringify({
      name: "cancellation-fixture",
      scripts: { test: "node app.js" },
    });
  const stop = new AbortController();
  let running = false;
  const stopTimer = setTimeout(() => stop.abort(), 15000);
  const pending = runner.execute(
    randomUUID(),
    waiting,
    "test",
    stop.signal,
    (text) => {
      if (text.includes("CANCEL_READY")) {
        running = true;
        stop.abort();
      }
    },
  );
  const cancelled = await pending;
  clearTimeout(stopTimer);
  assert.equal(running, true);
  assert.equal(cancelled.cleanupVerified, true);
  assert.notEqual(cancelled.exitCode, 0);
  console.log(
    "Real Docker build/output transfer, syntax test, failure and cancellation passed.",
  );
} finally {
  clearTimeout(timer);
  controller.abort();
  await runner.cleanup(id);
}
