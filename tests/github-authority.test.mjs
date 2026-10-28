import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubAuthority } from "../electron/github-authority.mjs";
import { BACKUP_FILES } from "../electron/backup.mjs";
async function dir(t) {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-authority-"));
  t.after(() => fs.rm(p, { recursive: true, force: true }));
  return p;
}
test("default deny, exact canonical repo and native consent for grant/revoke", async (t) => {
  const root = await dir(t),
    requests = [];
  let consent = false;
  const a = new GitHubAuthority(root, {
    approve: async (r) => {
      requests.push(r);
      return consent;
    },
  });
  await a.load();
  assert.equal(a.isAllowed({ owner: "Owner", repo: "Project" }), false);
  assert.deepEqual(await a.grant({ owner: "Owner", repo: "Project" }), {
    approved: false,
    allowed: false,
  });
  consent = true;
  await a.grant({ owner: "Owner", repo: "Project" });
  assert.equal(a.isAllowed({ owner: "OWNER", repo: "PROJECT" }), true);
  assert.equal(a.isAllowed({ owner: "Owner", repo: "Other" }), false);
  assert.equal(requests[1].action, "grant-github-publication");
  assert.deepEqual(requests[1].capabilities, ["new-branch-commit", "draft-pr"]);
  const b = new GitHubAuthority(root);
  await b.load();
  assert.equal(b.list().length, 1);
  consent = false;
  assert.deepEqual(await a.revoke({ owner: "owner", repo: "project" }), {
    approved: false,
    allowed: true,
  });
  consent = true;
  await a.revoke({ owner: "owner", repo: "project" });
  assert.equal(a.list().length, 0);
  assert.equal(requests.at(-1).action, "revoke-github-publication");
});
test("unknown fields, wildcard/path repositories, truthy nonboolean consent are rejected", async (t) => {
  const a = new GitHubAuthority(await dir(t), {
    approve: async () => ({ approved: true }),
  });
  await a.load();
  for (const input of [
    { owner: "a", repo: "*" },
    { owner: "a", repo: "../b" },
    { owner: "a", repo: "b", force: true },
  ])
    assert.throws(() => a.grant(input));
  await a.grant({ owner: "a", repo: "b" });
  assert.equal(a.list().length, 0);
});
test("concurrent changes serialize without lost grants", async (t) => {
  const a = new GitHubAuthority(await dir(t), { approve: async () => true });
  await a.load();
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      a.grant({ owner: "a", repo: `repo-${i}` }),
    ),
  );
  assert.equal(a.list().length, 20);
  await Promise.all([
    a.revoke({ owner: "a", repo: "repo-1" }),
    a.grant({ owner: "a", repo: "another" }),
  ]);
  assert.equal(a.list().length, 20);
});
test("corrupt and tampered authority preserved, mutation blocked until successful load", async (t) => {
  const root = await dir(t),
    file = path.join(root, "sebby-github-authority.json");
  for (const content of [
    "{broken",
    JSON.stringify({ version: 1, repositories: [], allowAll: true }),
    JSON.stringify({
      version: 1,
      repositories: [{ owner: "a", repo: "b", grantedAt: 1, merge: true }],
    }),
  ]) {
    await fs.writeFile(file, content);
    const a = new GitHubAuthority(root, { approve: async () => true });
    await assert.rejects(a.load(), /preserved/);
    await assert.rejects(a.grant({ owner: "a", repo: "b" }), /Load/);
    assert.equal(await fs.readFile(file, "utf8"), content);
  }
  assert.ok(!BACKUP_FILES.includes("sebby-github-authority.json"));
  assert.ok(!BACKUP_FILES.includes("sebby-github-history.json"));
});
test("authority limit cannot expand scope and failed reload disables old in-memory grants", async (t) => {
  const root = await dir(t),
    file = path.join(root, "sebby-github-authority.json");
  await fs.writeFile(
    file,
    JSON.stringify({
      version: 1,
      repositories: Array.from({ length: 100 }, (_, i) => ({
        owner: "a",
        repo: `r${i}`,
        grantedAt: 1,
      })),
    }),
  );
  const a = new GitHubAuthority(root, { approve: async () => true });
  await a.load();
  await assert.rejects(a.grant({ owner: "a", repo: "overflow" }));
  assert.equal(a.list().length, 100);
  await fs.writeFile(file, "{corrupt");
  await assert.rejects(a.load());
  assert.throws(() => a.isAllowed({ owner: "a", repo: "r0" }), /Load/);
});
