import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { zipSync, strToU8 } from "fflate";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-source-import-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { reviewSourceZip } =
  await import("../server/src/workspace/source-import.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { db } = await import("../server/src/db.js");
const { snapshot } = await import("../server/src/workspace/repository.js");
for (const id of ["alice", "bob"]) {
  db.prepare(
    "INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)",
  ).run(id, `${id}@example.test`, id, Date.now());
  db.prepare(
    "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
  ).run(id, id, Date.now(), Date.now() + 600000);
}
after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
const zip = (files: Record<string, string | Uint8Array>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, text]) => [
          name,
          typeof text === "string" ? strToU8(text) : text,
        ]),
      ),
    ),
  );
const review = (data: Buffer, strip = true) =>
  reviewSourceZip(data, "Imported app", strip);
const request = (
  url: string,
  method = "GET",
  body?: string | Buffer,
  user = "alice",
  origin = "http://localhost",
  type = "application/json",
) =>
  projectsApi.request(`http://localhost${url}`, {
    method,
    headers: {
      cookie: `grokbot_session=${user}`,
      origin,
      "content-type": type,
    },
    ...(body === undefined ? {} : { body }),
  });
const central = (data: Buffer) =>
  data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));

test("ZIP review preserves source, removes an optional wrapper and reports excluded files", async () => {
  const input = zip({
    "demo-main/index.html": "<!doctype html><h1>Imported source</h1>",
    "demo-main/src/main.js": 'console.log("hello")',
    "demo-main/.env": "SECRET=private",
    "demo-main/node_modules/pkg/index.js": "excluded",
    "demo-main/dist/app.js": "excluded",
    "demo-main/public/icon.png": new Uint8Array([0, 1, 2]),
    "demo-main/.npmrc": "token=private",
    "demo-main/README.md": "# Demo",
  });
  const result = await review(input);
  assert.equal(result.sourceRoot, "demo-main/");
  assert.deepEqual(
    result.document.files.map((f) => f.path),
    ["index.html", "src/main.js", "README.md"],
  );
  assert.equal(result.document.files[1].content, 'console.log("hello")');
  assert.equal(result.skipped.length, 5);
  assert.equal(result.archiveSha256.length, 64);
  assert.equal(result.document.scene.objects.length, 0);
  assert.ok(!JSON.stringify(result.document).includes("private"));
  assert.equal(
    (await review(input, false)).document.files[0].path,
    "demo-main/index.html",
  );
  assert.equal(
    (await review(zip({ "index.html": "<p>root</p>", "src/app.js": "1" })))
      .sourceRoot,
    "",
  );
});

test("ZIP review refuses unsafe, duplicate, overlapping and special paths", async () => {
  for (const name of [
    "../escape.js",
    "/absolute.js",
    "src\\escape.js",
    "CON.js",
    "trailing./a.js",
  ])
    await assert.rejects(review(zip({ [name]: "x" })));
  await assert.rejects(review(zip({ "A.js": "a", "a.js": "b" })), /collid/);
  await assert.rejects(
    review(zip({ src: "file", "src/app.js": "code" })),
    /overlap/,
  );
  const duplicate = zip({ "a.js": "a", "b.js": "b" });
  // Match both local and central filenames; duplicate entries must never overwrite.
  for (let i = 0; i <= duplicate.length - 4; i++)
    if (duplicate.subarray(i, i + 4).toString() === "b.js") duplicate[i] = 97;
  await assert.rejects(review(duplicate), /duplicate/);
  const linked = zip({ "link.js": "target.js" });
  linked.writeUInt32LE(0xa1ff0000, central(linked) + 38);
  await assert.rejects(review(linked), /links/);
  const encrypted = zip({ "a.js": "hello" });
  encrypted.writeUInt16LE(1, central(encrypted) + 8);
  await assert.rejects(review(encrypted), /Encrypted/);
});

test("ZIP inspection enforces upload, entry, expanded size and file count limits", async () => {
  await assert.rejects(review(Buffer.alloc(4_000_001)), /4 MB/);
  await assert.rejects(
    review(
      zip(
        Object.fromEntries(
          Array.from({ length: 513 }, (_, i) => [`dist/${i}.js`, "a"]),
        ),
      ),
    ),
    /512/,
  );
  await assert.rejects(
    review(
      zip(
        Object.fromEntries(
          Array.from({ length: 41 }, (_, i) => [`${i}.js`, "a"]),
        ),
      ),
    ),
    /40 source/,
  );
  await assert.rejects(
    review(zip({ "big.js": "x".repeat(100_001) })),
    /100 KB/,
  );
  await assert.rejects(
    review(
      zip(
        Object.fromEntries(
          Array.from({ length: 7 }, (_, i) => [`${i}.js`, "x".repeat(90_000)]),
        ),
      ),
    ),
    /600 KB/,
  );
  // A tiny declared size cannot bypass decompression limits.
  const forged = zip({ "bomb.js": "x".repeat(300_000) });
  forged.writeUInt32LE(1, central(forged) + 24);
  await assert.rejects(review(forged));
});

test("ZIP inspection rejects corrupt, binary and invalid UTF-8 source without partial imports", async () => {
  await assert.rejects(review(Buffer.from("not a zip")));
  await assert.rejects(
    review(zip({ "bad.js": new Uint8Array([0xff, 0xfe, 0xfd]) })),
    /UTF-8/,
  );
  await assert.rejects(
    review(zip({ "bad.js": new Uint8Array([65, 0, 66]) })),
    /binary/,
  );
  await assert.rejects(
    review(zip({ ".env": "secret", "photo.png": "image" })),
    /No supported/,
  );
  const corrupted = zip({ "index.html": "<p>content</p>" });
  corrupted.writeUInt32LE(0, central(corrupted) + 16);
  await assert.rejects(review(corrupted), /integrity/);
  // Text with many JSON escapes still obeys the existing JSON request cap.
  await assert.rejects(
    review(
      zip(
        Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => [
            `${i}.txt`,
            "\t".repeat(100_000),
          ]),
        ),
      ),
    ),
    /JSON encoding/,
  );
});

test("authenticated ZIP inspection creates nothing until a reviewed document is imported", async () => {
  const input = zip({
    "app-main/index.html": "<!doctype html><h1>Source ZIP fixture</h1>",
    "app-main/main.js": "console.log(1)",
  });
  const count = () =>
    db.prepare("SELECT COUNT(*) AS n FROM workspace_projects").get().n;
  const before = count();
  assert.equal(
    (
      await request(
        "/import-source/review",
        "POST",
        input,
        "missing",
        undefined,
        "application/zip",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/import-source/review",
        "POST",
        input,
        "alice",
        "https://other.test",
        "application/zip",
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/import-source/review", "POST", input)).status,
    415,
  );
  const inspected = await request(
    "/import-source/review?name=Reviewed%20app&stripRoot=true",
    "POST",
    input,
    "alice",
    undefined,
    "application/zip",
  );
  assert.equal(inspected.status, 200);
  const candidate = await inspected.json();
  assert.equal(count(), before);
  const created = await request(
    "/import",
    "POST",
    JSON.stringify(candidate.document),
  );
  assert.equal(created.status, 201);
  const { project } = await created.json();
  assert.equal(project.name, "Reviewed app");
  assert.equal(project.revision, 1);
  assert.equal(count(), before + 1);
  assert.equal(
    (await request(`/${project.id}`, "GET", undefined, "bob")).status,
    404,
  );
  const preview = await (await request(`/${project.id}/preview`)).json();
  assert.match(preview.html, /Source ZIP fixture/);
  const saved = await request(
    `/${project.id}`,
    "PUT",
    JSON.stringify({
      ...candidate.document,
      revision: 1,
      files: [
        { path: "index.html", content: "<h1>Edited import</h1>" },
        project.files[1],
      ],
    }),
  );
  assert.equal(saved.status, 200);
  const changes = await (
    await request(`/${project.id}/diff?from=1&to=2`)
  ).json();
  assert.match(changes.diff, /Edited import/);
  const updated = (await saved.json()).project;
  const snap = await snapshot(
    { name: updated.name, files: updated.files, scene: updated.scene },
    randomUUID(),
  );
  assert.match(snap.commit, /^[0-9a-f]{40}$/);
});

test("ZIP upload and JSON writes retain separate body limits and reject invalid requests", async () => {
  assert.equal(
    (
      await request(
        "/import-source/review",
        "POST",
        Buffer.alloc(4_000_001),
        "alice",
        undefined,
        "application/zip",
      )
    ).status,
    413,
  );
  assert.equal(
    (await request("/import", "POST", " ".repeat(1_000_001))).status,
    413,
  );
  assert.equal(
    (
      await request(
        "/import-source/review?name=",
        "POST",
        Buffer.from("invalid"),
        "alice",
        undefined,
        "application/zip",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/import-source/review",
        "POST",
        zip({ "a.js": "a".repeat(100_001) }),
        "alice",
        undefined,
        "application/zip",
      )
    ).status,
    400,
  );
});

test("a real Git source archive imports with regular modes and a removable repository wrapper", async () => {
  const document = {
    name: "Git archive fixture",
    files: [
      { path: "index.html", content: "<h1>Git archive</h1>" },
      { path: "src/main.js", content: 'console.log("archive")' },
    ],
    scene: { objects: [] },
  };
  const saved = await snapshot(document, randomUUID());
  const archive = execFileSync(
    "git",
    ["archive", "--format=zip", "--prefix=demo-main/", "HEAD"],
    { cwd: saved.directory },
  );
  const candidate = await review(archive);
  assert.deepEqual(candidate.document.files, document.files);
  assert.equal(candidate.sourceRoot, "demo-main/");
});
