// Explicit read-only public network acceptance; no GitHub or app credentials.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-public-github-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { reviewGithubRepository } =
  await import("../server/src/workspace/github-import.js");
const { db } = await import("../server/src/db.js");
await import("../server/src/workspace/repository.js");
try {
  const review = await reviewGithubRepository({
    url: "https://github.com/octocat/Hello-World",
    name: "Public GitHub acceptance",
    ref: "HEAD",
  });
  assert.match(review.source!.commit, /^[a-f0-9]{40}$/);
  assert.equal(
    review.source!.repository,
    "https://github.com/octocat/Hello-World",
  );
  assert.ok(review.document.files.some((file) => file.path === "README"));
  assert.ok(
    review.document.files.some(
      (file) => file.path === "SEBBY-GITHUB-SOURCE.json",
    ),
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM workspace_projects").get() as any).n,
    0,
  );
  console.log(
    JSON.stringify(
      {
        result: "Public GitHub source review passed",
        source: review.source,
        files: review.document.files.map((file) => file.path),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
