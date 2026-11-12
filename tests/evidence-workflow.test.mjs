import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { Workspace } from "../electron/services.mjs";
import {
  EvidenceWorkflow,
  buildStaticPrototype,
  inspectMarkup,
  installEvidenceWorkflow,
  testStaticPrototype,
} from "../electron/evidence-workflow.mjs";

const target =
  '<!doctype html><html><body><main><h1>PRIVATE TARGET BRAND</h1><section><h2>Target feature</h2></section><script>globalThis.DO_NOT_EXECUTE = true</script><img src="https://example.com/asset.png"><form action="https://example.com/send"></form></main></body></html>';
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-evidence-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project"),
    dataDirectory = path.join(root, "data");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "target.html"), target);
  const workspace = new Workspace();
  await workspace.select(project);
  const approvals = [],
    previews = [];
  const service = new EvidenceWorkflow({
    workspace,
    dataDirectory,
    confirm: async (...details) => {
      approvals.push(details);
      return true;
    },
    preview: {
      openArtifact: async (artifact) => {
        previews.push(artifact);
        return { phase: "open", lastOutcome: "opened" };
      },
    },
    ...options,
  });
  return {
    root,
    project,
    dataDirectory,
    workspace,
    approvals,
    previews,
    service,
  };
}

test("local authorization/input validation and bounded observations have no execution", async (t) => {
  const f = await fixture(t);
  for (const input of [
    { path: "target.html", authorized: false },
    { path: "../target.html", authorized: true },
    { path: "https://example.com", authorized: true },
    { path: "target.js", authorized: true },
    { path: "target.html", authorized: true, command: "run" },
  ])
    await assert.rejects(f.service.prepare(input));
  assert.equal(f.approvals.length, 0);
  const result = await f.service.prepare({
    path: "target.html",
    authorized: true,
  });
  assert.equal(result.status, "prepared");
  assert.equal(result.proposal.source.sha256, hash(target));
  assert.equal(result.proposal.observations.scripts, 1);
  assert.equal(result.proposal.observations.resourceReferences, 2);
  assert.deepEqual(
    result.proposal.observations.headings.map((h) => h.tag),
    ["h1", "h2"],
  );
  assert.equal(globalThis.DO_NOT_EXECUTE, undefined);
  assert.equal(JSON.stringify(result).includes("PRIVATE TARGET BRAND"), false);
  assert.equal(
    JSON.stringify(result).includes("https://example.com/send"),
    false,
  );
  assert.throws(() => inspectMarkup("x".repeat(256 * 1024 + 1)));
  assert.throws(() => inspectMarkup("<i></i>".repeat(12001)), /too many nodes/);
});

test("reviewed blueprint builds original isolated-by-location static artifact with actual checks then verified preview", async (t) => {
  const f = await fixture(t);
  const { proposal } = await f.service.prepare({
    path: "target.html",
    authorized: true,
  });
  proposal.blueprint.sectionCount = 99;
  const result = await f.service.build({ proposalId: proposal.id });
  assert.equal(result.status, "built");
  assert.equal(result.artifact.tests.length, 4);
  assert.equal(
    result.artifact.tests.every((r) => r.passed),
    true,
  );
  assert.equal(
    result.artifact.directory.startsWith(
      path.join(f.dataDirectory, "evidence-builds") + path.sep,
    ),
    true,
  );
  const html = await fs.readFile(
    path.join(result.artifact.directory, result.artifact.path),
    "utf8",
  );
  assert.equal(inspectMarkup(html).elements.section, 2);
  assert.equal(html.includes("PRIVATE TARGET BRAND"), false);
  assert.equal(html.includes("DO_NOT_EXECUTE"), false);
  assert.equal(html.includes("example.com"), false);
  assert.equal(hash(html), result.artifact.sha256);
  const report = JSON.parse(
    await fs.readFile(
      path.join(result.artifact.directory, "evidence.json"),
      "utf8",
    ),
  );
  assert.equal(report.format, "sebby-static-evidence");
  assert.equal(report.proposal.source.sha256, hash(target));
  assert.equal(report.artifact.sha256, hash(html));
  assert.equal(JSON.stringify(report).includes("PRIVATE TARGET BRAND"), false);
  assert.equal(
    await fs.readFile(path.join(f.project, "target.html"), "utf8"),
    target,
  );
  assert.equal(
    (await f.service.previewBuild({ buildId: result.artifact.id })).status,
    "previewed",
  );
  assert.deepEqual(f.previews[0], {
    directory: result.artifact.directory,
    path: "index.html",
    sha256: result.artifact.sha256,
  });
});

test("native denials do not inspect or create a build", async (t) => {
  let approved = false;
  const f = await fixture(t, { confirm: async () => approved });
  assert.equal(
    (await f.service.prepare({ path: "target.html", authorized: true })).status,
    "denied",
  );
  approved = true;
  const { proposal } = await f.service.prepare({
    path: "target.html",
    authorized: true,
  });
  approved = false;
  assert.equal(
    (await f.service.build({ proposalId: proposal.id })).status,
    "denied",
  );
  await assert.rejects(fs.stat(path.join(f.dataDirectory, "evidence-builds")), {
    code: "ENOENT",
  });
});

test("source changes before or during native build review prevent output", async (t) => {
  for (const stage of ["before", "during"]) {
    const f = await fixture(t);
    const { proposal } = await f.service.prepare({
      path: "target.html",
      authorized: true,
    });
    if (stage === "before")
      await fs.writeFile(
        path.join(f.project, "target.html"),
        "<h1>changed</h1>",
      );
    else
      f.service.confirm = async () => {
        await fs.writeFile(
          path.join(f.project, "target.html"),
          "<h1>changed</h1>",
        );
        return true;
      };
    await assert.rejects(
      f.service.build({ proposalId: proposal.id }),
      /Source changed/,
    );
    await assert.rejects(
      fs.stat(path.join(f.dataDirectory, "evidence-builds")),
      { code: "ENOENT" },
    );
  }
});

test("workspace changes or shutdown during pending consent cannot start late work", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, { confirm: () => pending });
  const prepare = f.service.prepare({ path: "target.html", authorized: true });
  assert.equal(f.service.isBusy, true);
  await assert.rejects(
    f.service.prepare({ path: "target.html", authorized: true }),
    /Finish/,
  );
  await f.service.shutdown();
  release(true);
  await assert.rejects(prepare, /closed/);
  assert.equal(f.service.isBusy, false);
  await assert.rejects(
    f.service.prepare({ path: "target.html", authorized: true }),
    /closed/,
  );
  const other = await fixture(t);
  other.service.confirm = async () => {
    other.workspace.root = null;
    return true;
  };
  await assert.rejects(
    other.service.prepare({ path: "target.html", authorized: true }),
    /workspace changed/,
  );
});

test("tampered or hardlinked artifacts never reach preview and absent preview is explicit", async (t) => {
  const f = await fixture(t);
  const { proposal } = await f.service.prepare({
    path: "target.html",
    authorized: true,
  });
  const { artifact } = await f.service.build({ proposalId: proposal.id });
  const filename = path.join(artifact.directory, "index.html");
  const original = await fs.readFile(filename);
  await fs.writeFile(filename, "<script>changed()</script>");
  await assert.rejects(
    f.service.previewBuild({ buildId: artifact.id }),
    /artifact changed/,
  );
  assert.equal(f.previews.length, 0);
  await fs.writeFile(filename, original);
  await fs.link(filename, path.join(f.root, "hardlink.html"));
  await assert.rejects(
    f.service.previewBuild({ buildId: artifact.id }),
    /path type/,
  );
  assert.equal(f.previews.length, 0);
  const unavailable = await fixture(t, { preview: null });
  const prepared = await unavailable.service.prepare({
    path: "target.html",
    authorized: true,
  });
  const built = await unavailable.service.build({
    proposalId: prepared.proposal.id,
  });
  await assert.rejects(
    unavailable.service.previewBuild({ buildId: built.artifact.id }),
    /preview is unavailable/,
  );
});

test("fixed recipe checks reject active/network content and reports do not turn denial into success", async (t) => {
  const html = buildStaticPrototype(3);
  assert.equal(
    testStaticPrototype(html, 3).every((r) => r.passed),
    true,
  );
  assert.throws(
    () => testStaticPrototype(html + "<script>bad()</script>", 3),
    /failed/,
  );
  assert.throws(
    () => testStaticPrototype(html + '<img src="https://example.com">', 3),
    /failed/,
  );
  assert.throws(() => buildStaticPrototype(9));
  const f = await fixture(t, {
    preview: {
      openArtifact: async () => ({ phase: "closed", lastOutcome: "denied" }),
    },
  });
  const { proposal } = await f.service.prepare({
    path: "target.html",
    authorized: true,
  });
  const { artifact } = await f.service.build({ proposalId: proposal.id });
  assert.equal(
    (await f.service.previewBuild({ buildId: artifact.id })).status,
    "not-opened",
  );
});

test("only exact scoped IPC operations are registered", async (t) => {
  const f = await fixture(t);
  const handlers = new Map();
  const service = installEvidenceWorkflow({
    register: (name, fn) => handlers.set(name, fn),
    workspace: f.workspace,
    dataDirectory: f.dataDirectory,
    confirm: async () => true,
  });
  assert.deepEqual(
    [...handlers.keys()],
    ["evidence-prepare", "evidence-build", "evidence-preview"],
  );
  await assert.rejects(
    service.build({ proposalId: "unknown", executable: "node" }),
  );
  await assert.rejects(
    service.previewBuild({ buildId: "00000000-0000-0000-0000-000000000000" }),
    /Unknown build/,
  );
});
