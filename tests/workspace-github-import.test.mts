import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { zipSync, strToU8 } from "fflate";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-github-import-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { db } = await import("../server/src/db.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const { githubRepository, reviewGithubRepository, createGithubImportApi } =
  await import("../server/src/workspace/github-import.js");
for (const id of ["alice", "bob", "charlie"]) {
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
const commit = "a".repeat(40),
  input = {
    url: "https://github.com/example/demo.git",
    name: "Reviewed GitHub app",
    ref: "feature/source",
  };
const archive = (
  files: Record<string, string> = {
    "demo-a/index.html": "<h1>Imported GitHub fixture</h1>",
    "demo-a/src/app.js": 'console.log("fixture")',
    "demo-a/.env": "PRIVATE=filtered",
  },
) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([p, v]) => [p, strToU8(v)]),
      ),
    ),
  );
function transport(
  options: {
    location?: string;
    files?: Record<string, string>;
    private?: boolean;
    status?: number;
    sha?: string;
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const payload = archive(options.files);
  const fetcher: typeof fetch = async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, init });
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(new Headers(init.headers).has("cookie"), false);
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    if (value === "https://api.github.com/repos/example/demo")
      return Response.json(
        { private: options.private ?? false, full_name: "example/demo" },
        { status: options.status || 200 },
      );
    if (value.includes("/commits/")) {
      assert.equal(
        new Headers(init.headers).get("accept"),
        "application/vnd.github.sha",
      );
      return new Response(options.sha ?? commit);
    }
    if (value.includes("/zipball/"))
      return new Response(null, {
        status: 302,
        headers: {
          location:
            options.location ||
            `https://codeload.github.com/example/demo/legacy.zip/${commit}`,
        },
      });
    if (value.startsWith("https://codeload.github.com/"))
      return new Response(payload);
    throw new Error("Unexpected network request " + value);
  };
  return { fetcher, calls, payload };
}
const request = (
  app: any,
  url: string,
  body: unknown,
  user = "alice",
  origin = "http://localhost",
) =>
  app.request("http://localhost" + url, {
    method: "POST",
    headers: {
      cookie: `grokbot_session=${user}`,
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });

test("GitHub URL parsing rejects arbitrary hosts, credentials, ports and normalized traversal", () => {
  assert.deepEqual(githubRepository("https://github.com/example/demo.git"), {
    owner: "example",
    repo: "demo",
    url: "https://github.com/example/demo",
  });
  assert.equal(
    githubRepository("https://github.com/example/demo/").repo,
    "demo",
  );
  for (const url of [
    "http://github.com/example/demo",
    "https://evil.test/example/demo",
    "https://github.com.evil.test/example/demo",
    "https://github.com@evil.test/example/demo",
    "https://user@github.com/example/demo",
    "https://github.com:443/example/demo",
    "https://github.com/example/demo?token=secret",
    "https://github.com/example/demo#x",
    "https://github.com/example/../other/demo",
    "https://github.com/example/demo/tree/main",
    "https://github.com/example/%2e%2e",
    "https://github.com/example\\demo",
    " https://github.com/example/demo",
  ])
    assert.throws(() => githubRepository(url), undefined, url);
});

test("GitHub review pins a commit, restricts redirects, filters source and retains origin metadata", async () => {
  const { fetcher, calls, payload } = transport();
  const result = await reviewGithubRepository(input, fetcher);
  assert.equal(calls.length, 4);
  assert.equal(
    calls[1].url,
    "https://api.github.com/repos/example/demo/commits/feature%2Fsource",
  );
  assert.equal(
    calls[2].url,
    `https://api.github.com/repos/example/demo/zipball/${commit}`,
  );
  assert.deepEqual(result.source, {
    provider: "github",
    repository: "https://github.com/example/demo",
    requestedRef: "feature/source",
    commit,
    archiveSha256: createHash("sha256").update(payload).digest("hex"),
  });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.document.files.length, 3);
  const record = result.document.files.find(
    (f) => f.path === "SEBBY-GITHUB-SOURCE.json",
  )!;
  assert.deepEqual(JSON.parse(record.content), result.source);
  assert.ok(!JSON.stringify(result.document).includes("PRIVATE=filtered"));
  for (const location of [
    "https://evil.test/example/demo/zip/" + commit,
    "http://codeload.github.com/example/demo/zip/" + commit,
    "https://codeload.github.com/other/demo/zip/" + commit,
    "https://codeload.github.com/example/demo/zip/main",
    "https://codeload.github.com/example/demo/zip/" +
      commit +
      "?token=unexpected",
    "https://user@codeload.github.com/example/demo/zip/" + commit,
  ]) {
    const t = transport({ location });
    await assert.rejects(reviewGithubRepository(input, t.fetcher), /redirect/);
    assert.equal(t.calls.length, 3);
  }
});

test("GitHub review rejects private/oversized/corrupt source and reserved provenance collisions", async () => {
  await assert.rejects(
    reviewGithubRepository(input, transport({ private: true }).fetcher),
    /public/,
  );
  await assert.rejects(
    reviewGithubRepository(input, transport({ status: 404 }).fetcher),
    /not found/,
  );
  await assert.rejects(
    reviewGithubRepository(input, transport({ status: 403 }).fetcher),
    /rate limit/,
  );
  await assert.rejects(
    reviewGithubRepository(input, transport({ sha: "short" }).fetcher),
    /full commit/,
  );
  await assert.rejects(
    reviewGithubRepository({ ...input, ref: "../secret" }, transport().fetcher),
    /traversal/,
  );
  for (const ref of [
    ".",
    "feature/./source",
    "feature/.hidden",
    "feature/source.lock",
  ]) {
    await assert.rejects(
      reviewGithubRepository({ ...input, ref }, transport().fetcher),
      /traversal/,
    );
  }

  await assert.rejects(
    reviewGithubRepository(
      input,
      transport({ files: { "root/SEBBY-GITHUB-SOURCE.json": "{}" } }).fetcher,
    ),
    /reserved/,
  );
  await assert.rejects(
    reviewGithubRepository(
      input,
      transport({
        files: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`root/${i}.js`, "a"]),
        ),
      }).fetcher,
    ),
    /39 source/,
  );
  const { fetcher } = transport();
  const tooBig: typeof fetch = async (url, init) =>
    String(url).startsWith("https://codeload")
      ? new Response("x", { headers: { "content-length": "4000001" } })
      : fetcher(url, init);
  await assert.rejects(reviewGithubRepository(input, tooBig), /size limit/);
  const invalid: typeof fetch = async (url, init) =>
    String(url).startsWith("https://codeload")
      ? new Response("not a zip")
      : fetcher(url, init);
  await assert.rejects(reviewGithubRepository(input, invalid), /cannot fit/);
});

test("GitHub review is session/origin protected, creates nothing and imports into a separate owned project", async () => {
  const app = createGithubImportApi(transport().fetcher),
    count = () =>
      db.prepare("SELECT COUNT(*) AS n FROM workspace_projects").get().n,
    before = count();
  assert.equal((await request(app, "/review", input, "missing")).status, 401);
  assert.equal(
    (await request(app, "/review", input, "alice", "https://other.test"))
      .status,
    403,
  );
  assert.equal(
    (await request(app, "/review", { ...input, extra: "unexpected" })).status,
    400,
  );
  const response = await request(app, "/review", input);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(count(), before);
  const candidate = await response.json();
  const created = await request(projectsApi, "/import", candidate.document);
  assert.equal(created.status, 201);
  assert.equal(count(), before + 1);
  const project = (await created.json()).project;
  assert.ok(
    project.files.some((f: any) => f.path === "SEBBY-GITHUB-SOURCE.json"),
  );
  assert.equal(project.revision, 1);
  assert.equal(
    (
      await projectsApi.request("http://localhost/" + project.id, {
        headers: { cookie: "grokbot_session=bob" },
      })
    ).status,
    404,
  );
  const preview = await projectsApi.request(
    "http://localhost/" + project.id + "/preview",
    { headers: { cookie: "grokbot_session=alice" } },
  );
  assert.equal(preview.status, 200);
  assert.match((await preview.json()).html, /Imported GitHub fixture/);
});

test("GitHub imports bound concurrency per owner and release slots after failure", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r)),
    base = transport().fetcher;
  let arrivals = 0,
    block = true;
  const fetcher: typeof fetch = async (url, init) => {
    if (block) {
      if (++arrivals === 2) entered();
      await gate;
    }
    return base(url, init);
  };
  const app = createGithubImportApi(fetcher),
    alice = request(app, "/review", input),
    bob = request(app, "/review", input, "bob");
  await started;
  assert.equal((await request(app, "/review", input)).status, 429);
  assert.equal((await request(app, "/review", input, "charlie")).status, 429);
  block = false;
  release();
  assert.equal((await alice).status, 200);
  assert.equal((await bob).status, 200);
  assert.equal((await request(app, "/review", input)).status, 200);
  const failed = createGithubImportApi(async () => {
    throw new Error("network");
  });
  assert.equal((await request(failed, "/review", input)).status, 502);
  assert.equal((await request(failed, "/review", input)).status, 502);
});

test("GitHub archive streaming bounds actual bytes even without Content-Length", async () => {
  const { fetcher } = transport();
  let cancelled = false;
  const large: typeof fetch = async (url, init) =>
    String(url).startsWith("https://codeload")
      ? new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(65536));
            },
            cancel() {
              cancelled = true;
            },
          }),
        )
      : fetcher(url, init);
  await assert.rejects(reviewGithubRepository(input, large), /size limit/);
  assert.equal(cancelled, true);
});
