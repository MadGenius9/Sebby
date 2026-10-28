import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parseStrictJson,
  validateEnvelope,
} from "../native/isolation-image/runner.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
function fixture(extra = []) {
  const files = [
    {
      path: "package.json",
      value: JSON.stringify({
        scripts: { build: "untrusted command never executed in this test" },
      }),
    },
    {
      path: "package-lock.json",
      value: JSON.stringify({ lockfileVersion: 3, packages: {} }),
    },
    ...extra,
  ]
    .map(({ path, value }) => ({
      path,
      base64: Buffer.from(value).toString("base64"),
      sha256: hash(value),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const snapshotHash = hash(
    JSON.stringify(
      files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        bytes: Buffer.from(f.base64, "base64").length,
      })),
    ),
  );
  const expected = {
    recipe: "web-build",
    snapshotHash,
    lockSha256: files.find((f) => f.path === "package-lock.json").sha256,
    wrapperSha256: "a".repeat(64),
  };
  return {
    expected,
    doc: {
      format: "sebby-snapshot-v1",
      recipe: "web-build",
      snapshotHash,
      lockSha256: expected.lockSha256,
      files,
    },
  };
}
test("independent wrapper parser rejects escaped duplicate and prototype keys without executing recipes", () => {
  for (const text of [
    '{"x":1,"\\u0078":2}',
    '{"nested":{"__proto__":{}}}',
    '{"constructor":{}}',
  ])
    assert.throws(() => parseStrictJson(text));
});
test("independent wrapper envelope rejects normalization collisions and host-like paths before any executor", () => {
  for (const extra of [
    [
      { path: "café.js", value: "a" },
      { path: "cafe\u0301.js", value: "b" },
    ],
    [{ path: "C:/secret.js", value: "x" }],
    [{ path: "../secret.js", value: "x" }],
  ]) {
    const { doc, expected } = fixture(extra);
    assert.throws(() => validateEnvelope(JSON.stringify(doc), expected));
  }
});
test("independent wrapper binds canonical bytes, selected recipe and complete manifest", () => {
  const { doc, expected } = fixture();
  assert.equal(validateEnvelope(JSON.stringify(doc), expected).script, "build");
  assert.throws(() =>
    validateEnvelope(JSON.stringify(doc), { ...expected, recipe: "web-test" }),
  );
  doc.files[0].base64 += "\n";
  assert.throws(() => validateEnvelope(JSON.stringify(doc), expected));
  assert.throws(() =>
    validateEnvelope(" ".repeat(8 * 1024 * 1024 + 1), expected),
  );
});
