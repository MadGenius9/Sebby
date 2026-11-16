import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  dependencyFingerprint,
  dependencyPlan,
} from "../server/src/workspace/dependencies.js";
import type { ProjectDocument } from "../server/src/workspace/schema.js";
const image = "registry.example.test/sebby/react@sha256:" + "a".repeat(64),
  base = "node@sha256:" + "b".repeat(64);
function fixture(): ProjectDocument {
  const pkg = {
    name: "fixture",
    scripts: { build: "vite build" },
    dependencies: { react: "18.3.1" },
    devDependencies: { vite: "8.3.6" },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
      },
      "node_modules/react": { version: "18.3.1" },
      "node_modules/vite": { version: "8.3.6" },
    },
  };
  return {
    name: "Dependency contract fixture",
    scene: { objects: [] },
    files: [
      { path: "package.json", content: JSON.stringify(pkg) },
      { path: "package-lock.json", content: JSON.stringify(lock) },
    ],
  };
}
test("exact dependency lock hashes select only the operator-provisioned pinned image", () => {
  const doc = fixture(),
    hash = createHash("sha256").update(doc.files[1].content).digest("hex");
  assert.equal(dependencyFingerprint(doc), hash);
  const catalog = JSON.stringify([{ lockHash: hash, image }]);
  assert.deepEqual(dependencyPlan(doc, base, catalog), {
    image,
    lockHash: hash,
  });
  doc.files[0].content = doc.files[0].content.replace(
    "vite build",
    "vite build --emptyOutDir",
  );
  assert.equal(dependencyPlan(doc, base, catalog).image, image);
  doc.files[1].content += "\n";
  assert.throws(() => dependencyPlan(doc, base, catalog), /No unique prebuilt/);
});
test("missing, inconsistent, linked and unpinned dependency configurations are refused", () => {
  const doc = fixture();
  assert.throws(
    () => dependencyFingerprint({ ...doc, files: [doc.files[0]] }),
    /matching package-lock/,
  );
  const changed = structuredClone(doc);
  changed.files[0].content = changed.files[0].content.replace(
    "18.3.1",
    "19.0.0",
  );
  assert.throws(() => dependencyFingerprint(changed), /do not match/);
  const linked = structuredClone(doc);
  linked.files[1].content = linked.files[1].content.replace(
    '"version":"18.3.1"',
    '"version":"18.3.1","link":true',
  );
  assert.throws(() => dependencyFingerprint(linked), /Linked/);
  const hash = dependencyFingerprint(doc)!;
  assert.throws(
    () =>
      dependencyPlan(
        doc,
        base,
        JSON.stringify([{ lockHash: hash, image: "node:latest" }]),
      ),
    /digest-pinned/,
  );
  assert.throws(
    () =>
      dependencyPlan(
        doc,
        base,
        JSON.stringify([
          { lockHash: hash, image },
          { lockHash: hash, image },
        ]),
      ),
    /No unique prebuilt/,
  );
  assert.throws(() => dependencyPlan(doc, base, "[]"), /No unique prebuilt/);
  assert.throws(() => dependencyPlan(doc, base, "{broken"), /not valid JSON/);
});
test("dependency-free projects retain the base-image path without automatic installs", () => {
  const doc: ProjectDocument = {
    name: "Plain",
    scene: { objects: [] },
    files: [
      {
        path: "package.json",
        content: JSON.stringify({ scripts: { test: "node --check app.js" } }),
      },
    ],
  };
  assert.equal(dependencyFingerprint(doc), null);
  assert.deepEqual(dependencyPlan(doc, base, "[]"), {
    image: base,
    lockHash: null,
  });
  assert.throws(() => dependencyPlan(doc, "", "[]"), /Configure a preloaded/);
});

test("dependency context preparation copies only manifests and refuses existing output folders", async () => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-deps-context-"));
  try {
    const doc = fixture();
    doc.files.push({
      path: "private-notes.txt",
      content: "Fixture text must not enter the dependency build context",
    });
    const source = path.join(dir, "project.json"),
      target = path.join(dir, "context");
    await fs.writeFile(source, JSON.stringify(doc));
    const { stdout } = await exec(process.execPath, [
      "--import",
      "tsx",
      "scripts/prepare-dependencies.mts",
      source,
      target,
    ]);
    const report = JSON.parse(stdout);
    assert.equal(report.imageBuilt, false);
    assert.equal(report.lockHash, dependencyFingerprint(doc));
    assert.deepEqual((await fs.readdir(target)).sort(), [
      "Dockerfile",
      "package-lock.json",
      "package.json",
      "profile.json",
    ]);
    assert.equal(
      await fs.readFile(path.join(target, "package-lock.json"), "utf8"),
      doc.files[1].content,
    );
    await assert.rejects(
      exec(process.execPath, [
        "--import",
        "tsx",
        "scripts/prepare-dependencies.mts",
        source,
        target,
      ]),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
