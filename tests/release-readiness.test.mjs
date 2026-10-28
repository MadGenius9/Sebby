import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectReadiness,
  writeManifest,
} from "../scripts/release-readiness.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-release-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of [
    "electron",
    "dist",
    "skills",
    "docs",
    "node_modules/example",
    "node_modules/electron",
  ])
    await fs.mkdir(path.join(root, dir), { recursive: true });
  const pkg = {
    name: "fixture",
    version: "0.0.1",
    private: true,
    dependencies: { example: "1.0.0" },
    build: {
      files: [
        "dist/**/*",
        "electron/**/*",
        "skills/**/*",
        "package.json",
        "docs/THIRD-PARTY-NOTICES.md",
      ],
    },
  };
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  await fs.writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": pkg,
        "node_modules/example": { version: "1.0.0", license: "MIT" },
        "node_modules/electron": {
          version: "1.0.0",
          dev: true,
          license: "MIT",
        },
      },
    }),
  );
  for (const name of ["example", "electron"]) {
    await fs.writeFile(
      path.join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version: "1.0.0", license: "MIT" }),
    );
    await fs.writeFile(
      path.join(root, "node_modules", name, "LICENSE"),
      "Fixture license",
    );
  }
  await fs.writeFile(
    path.join(root, "electron", "main.mjs"),
    "export const fixture=true;",
  );
  await fs.writeFile(path.join(root, "dist", "index.html"), "<h1>Fixture</h1>");
  await fs.writeFile(
    path.join(root, "docs", "THIRD-PARTY-NOTICES.md"),
    "Fixture notices",
  );
  return { root, pkg };
}
test("manifest is deterministic, inventories real dependency licenses and reports missing native gates", async (t) => {
  const { root } = await fixture(t);
  const a = await collectReadiness(root),
    b = await collectReadiness(root);
  assert.deepEqual(a, b);
  assert.equal(a.productionDependencies.length, 1);
  assert.equal(a.productionDependencies[0].declaredLicense, "MIT");
  assert.equal(a.productionDependencies[0].licenseFiles.length, 1);
  assert.equal(a.productionDependencies[0].lockVersionMatches, true);
  assert.equal(a.electron.windowsBinaryPresent, false);
  assert.equal(a.readyForPublicDistribution, false);
  assert.equal(
    a.checks.find((x) => x.id === "windows-native-validation").status,
    "not-verified",
  );
});
test("forbidden packaged paths are reported without reading or including secret content", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, "electron", ".env"), "DO-NOT-READ");
  await fs.mkdir(path.join(root, "electron", "sebby-profile-vault"));
  await fs.writeFile(
    path.join(root, "electron", "sebby-profile-vault", "a.credential"),
    "SECRET-VAULT",
  );
  await fs.mkdir(path.join(root, "native/windows-job-runner"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "native/windows-job-runner/signing.key"),
    "NO-NATIVE-KEY",
  );
  const result = await collectReadiness(root);
  assert.ok(!JSON.stringify(result.source).includes("signing.key"));
  assert.ok(result.packaging.findings.some((x) => x.path === "electron/.env"));
  assert.ok(!JSON.stringify(result).includes("DO-NOT-READ"));
  assert.ok(!JSON.stringify(result).includes("SECRET-VAULT"));
  assert.equal(result.checks[0].status, "blocked");
});
test("broad packaging patterns, unreviewed extra resources and version mismatches fail policy", async (t) => {
  const { root, pkg } = await fixture(t);
  pkg.build.files = ["**/*"];
  pkg.build.extraResources = ["private"];
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  await fs.writeFile(
    path.join(root, "node_modules/example/package.json"),
    JSON.stringify({ name: "example", version: "9.0.0", license: "MIT" }),
  );
  const result = await collectReadiness(root);
  assert.ok(
    result.packaging.findings.some(
      (x) =>
        x.reason === "packaging-allowlist-differs-from-reviewed-explicit-list",
    ),
  );
  assert.ok(
    result.packaging.findings.some(
      (x) => x.reason === "unreviewed-packaging-extension",
    ),
  );
  assert.equal(result.productionDependencies[0].lockVersionMatches, false);
});
test("symlinked input is never followed and linked output parent is rejected", async (t) => {
  const { root } = await fixture(t);
  await fs.symlink(
    path.join(root, "docs"),
    path.join(root, "electron", "linked"),
  );
  const result = await collectReadiness(root);
  assert.ok(
    result.packaging.findings.some((x) => x.reason === "symlink-not-followed"),
  );
  await fs.symlink(path.join(root, "docs"), path.join(root, "linked-output"));
  await assert.rejects(
    writeManifest(root, "linked-output/report.json", result),
    /real directory/,
  );
});
test("optional output is create-only and confined to non-source workspace paths", async (t) => {
  const { root } = await fixture(t),
    result = await collectReadiness(root);
  await writeManifest(root, "docs/report.json", result);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, "docs/report.json"), "utf8")),
    result,
  );
  await assert.rejects(writeManifest(root, "docs/report.json", result));
  for (const target of [
    "../outside.json",
    "/tmp/out.json",
    ".hidden/report.json",
    "electron/report.json",
    "package.json",
  ])
    await assert.rejects(writeManifest(root, target, result));
});

test("notices packaging gate requires both exact allowlist entry and actual file", async (t) => {
  const { root, pkg } = await fixture(t);
  const good = await collectReadiness(root);
  assert.equal(
    good.checks.find((x) => x.id === "notices-packaging-declaration").status,
    "pass",
  );
  assert.ok(
    good.packaging.candidateFiles.some(
      (x) => x.path === "docs/THIRD-PARTY-NOTICES.md" && x.sha256,
    ),
  );
  pkg.build.files = pkg.build.files.filter((x) => !x.startsWith("docs/"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  const excluded = await collectReadiness(root);
  assert.equal(
    excluded.checks.find((x) => x.id === "notices-packaging-declaration")
      .status,
    "blocked",
  );
  pkg.build.files.push("docs/THIRD-PARTY-NOTICES.md");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  await fs.unlink(path.join(root, "docs/THIRD-PARTY-NOTICES.md"));
  const missing = await collectReadiness(root);
  assert.equal(
    missing.checks.find((x) => x.id === "notices-packaging-declaration").status,
    "blocked",
  );
});

test("GitHub configuration, authority and publication history are forbidden packaged stores", async (t) => {
  const { root } = await fixture(t);
  for (const name of [
    "sebby-github.json",
    "sebby-github-authority.json",
    "sebby-github-history.json",
  ])
    await fs.writeFile(
      path.join(root, "electron", name),
      "DO-NOT-INVENTORY-PRIVATE-STORE",
    );
  const result = await collectReadiness(root);
  for (const name of [
    "sebby-github.json",
    "sebby-github-authority.json",
    "sebby-github-history.json",
  ]) {
    assert.ok(
      result.packaging.findings.some(
        (x) =>
          x.path === `electron/${name}` &&
          x.reason === "forbidden-package-path-not-read",
      ),
    );
    assert.ok(
      !result.packaging.candidateFiles.some(
        (x) => x.path === `electron/${name}`,
      ),
    );
  }
  assert.equal(
    result.checks.find((x) => x.id === "packaging-source-policy").status,
    "blocked",
  );
  assert.ok(!JSON.stringify(result).includes("DO-NOT-INVENTORY-PRIVATE-STORE"));
});
