import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
const root = mkdtempSync(path.join(os.tmpdir(), "sebby-drive-"));
process.env.SEBBY_WORKSPACE_ONLY = "1";
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, "workspace.db");
const { db } = await import("../server/src/db.js");
const { createDriveApi } = await import("../server/src/workspace/drive.js");
const { projectsApi } = await import("../server/src/workspace/projects.js");
const config = {
  clientId: "fixture-client",
  clientSecret: "fixture-client-secret",
  key: randomUUID(),
  serverUrl: "http://localhost",
  appUrl: "http://localhost",
  pickerKey: "fixture-public-key",
  appId: "12345",
};
const scope = "https://www.googleapis.com/auth/drive.file";
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
let tokenScope = scope,
  expires = 3600,
  media = "A source-backed reference.",
  revocationFails = false,
  tokenBarrier: (() => Promise<void>) | null = null;
const requests: { url: string; init: RequestInit }[] = [];
const fakeFetch: typeof fetch = async (input, init = {}) => {
  const url = String(input);
  requests.push({ url, init });
  if (url === "https://oauth2.googleapis.com/token") {
    if (tokenBarrier) await tokenBarrier();
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get("client_secret"), "fixture-client-secret");
    if (body.get("grant_type") === "authorization_code") {
      const verifier = body.get("code_verifier")!;
      assert.equal(verifier.length, 64);
    }
    return Response.json({
      access_token: "fixture-sensitive-access",
      refresh_token: "fixture-sensitive-refresh",
      expires_in: expires,
      scope: tokenScope,
    });
  }
  if (url === "https://oauth2.googleapis.com/revoke")
    return new Response("", { status: revocationFails ? 503 : 200 });
  assert.equal(
    new Headers(init.headers).get("authorization"),
    "Bearer fixture-sensitive-access",
  );
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?"))
    return Response.json({
      files: [
        {
          id: "fixture-doc",
          name: "Reference",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });
  if (url.includes("/files/fixture-doc?fields="))
    return Response.json({
      id: "fixture-doc",
      name: "Fixture requirement",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-11-16T00:00:00Z",
    });
  if (url.includes("/files/fixture-doc/export?")) return new Response(media);
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?")) {
    assert.match(String(init.body), /revision/);
    return Response.json({
      id: "new-project-export",
      name: "Exported project.json",
    });
  }
  throw new Error("Unexpected fixture URL " + url);
};
const app = createDriveApi(config, fakeFetch);
const call = (
  url: string,
  method = "GET",
  body?: unknown,
  user = "alice",
  origin = "http://localhost",
) =>
  app.request("http://localhost" + url, {
    method,
    headers: {
      cookie: `grokbot_session=${user}`,
      "content-type": "application/json",
      origin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function start(user = "alice") {
  const response = await call("/connect", "POST", {}, user);
  assert.equal(response.status, 200);
  return new URL((await response.json()).url);
}
async function connect(user = "alice") {
  const url = await start(user);
  const response = await call(
    "/callback?state=" + url.searchParams.get("state") + "&code=fixture-code",
    "GET",
    undefined,
    user,
  );
  assert.equal(response.status, 302);
  return url;
}

test("Drive setup fails closed, requires sessions and refuses cross-origin writes", async () => {
  const missing = createDriveApi({ ...config, key: "" }, fakeFetch);
  assert.equal(
    (
      await missing.request("http://localhost/status", {
        headers: { cookie: "grokbot_session=alice" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await missing.request("http://localhost/connect", {
        method: "POST",
        headers: { cookie: "grokbot_session=alice" },
      })
    ).status,
    503,
  );
  assert.equal(
    (await call("/status", "GET", undefined, "unknown")).status,
    401,
  );
  assert.equal(
    (await call("/connect", "POST", {}, "alice", "https://other.example"))
      .status,
    403,
  );
  assert.equal((await call("/files", "GET", undefined, "bob")).status, 409);
});

test("Drive OAuth uses selected-file scope, PKCE, session-bound single-use state and encrypted tokens", async () => {
  const url = await start();
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), scope);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  const state = url.searchParams.get("state")!;
  assert.equal(
    (
      await call(
        "/callback?state=" + state + "&code=test",
        "GET",
        undefined,
        "bob",
      )
    ).status,
    400,
  );
  const response = await call("/callback?state=" + state + "&code=test");
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/workspace?drive=connected",
  );
  assert.equal(
    (await call("/callback?state=" + state + "&code=test")).status,
    400,
  );
  const stored = db
    .prepare("SELECT tokens FROM workspace_drive_connections WHERE user_id=?")
    .get("alice") as any;
  assert.ok(stored.tokens);
  assert.ok(!stored.tokens.includes("fixture-sensitive"));
  assert.equal((await (await call("/status")).json()).connected, true);
  assert.equal((await call("/files")).status, 200);
  assert.equal((await call("/files", "GET", undefined, "bob")).status, 409);
  const picker = await call("/picker-session", "POST", {});
  assert.equal(picker.headers.get("cache-control"), "no-store");
  assert.equal((await picker.json()).accessToken, "fixture-sensitive-access");
});

test("Drive reference provenance and exports use only owner-selected data and exact saved revisions", async () => {
  const reference = await call("/files/fixture-doc/reference");
  assert.equal(reference.status, 200);
  const imported = await reference.json();
  assert.match(imported.content, /A source-backed reference/);
  assert.equal(imported.source.fileId, "fixture-doc");
  assert.equal(
    imported.source.sha256,
    createHash("sha256").update(media).digest("hex"),
  );
  const created = await projectsApi.request("http://localhost/", {
    method: "POST",
    headers: {
      cookie: "grokbot_session=alice",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Drive export fixture" }),
  });
  const project = (await created.json()).project;
  assert.equal(
    (
      await call(
        "/export",
        "POST",
        { projectId: project.id, revision: 1 },
        "bob",
      )
    ).status,
    404,
  );
  assert.equal(
    (await call("/export", "POST", { projectId: project.id, revision: 99 }))
      .status,
    409,
  );
  const exported = await call("/export", "POST", {
    projectId: project.id,
    revision: 1,
  });
  assert.equal(exported.status, 201);
  assert.equal((await exported.json()).revision, 1);
  media = "x".repeat(80001);
  assert.equal((await call("/files/fixture-doc/reference")).status, 413);
  media = "A source-backed reference.";
  assert.ok(requests.every((r) => new URL(r.url).protocol === "https:"));
});

test("Drive rejects excessive grants, refreshes expired tokens and reports unconfirmed revocation", async () => {
  tokenScope = scope + " https://www.googleapis.com/auth/drive";
  const url = await start("bob");
  assert.equal(
    (
      await call(
        "/callback?state=" + url.searchParams.get("state") + "&code=scope",
        "GET",
        undefined,
        "bob",
      )
    ).status,
    403,
  );
  assert.equal(
    (await (await call("/status", "GET", undefined, "bob")).json()).connected,
    false,
  );
  tokenScope = scope;
  expires = 1;
  await connect("bob");
  expires = 3600;
  const before = requests.filter((r) => r.url.endsWith("/token")).length;
  assert.equal((await call("/files", "GET", undefined, "bob")).status, 200);
  assert.equal(
    requests.filter((r) => r.url.endsWith("/token")).length,
    before + 1,
  );
  revocationFails = true;
  const disconnected = await call("/disconnect", "POST", {}, "bob");
  assert.deepEqual(await disconnected.json(), {
    connected: false,
    revoked: false,
  });
  revocationFails = false;
  assert.equal((await call("/files", "GET", undefined, "bob")).status, 409);
});

test("disconnect during authorization or token refresh cannot resurrect the Drive connection", async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => (entered = resolve));
  tokenBarrier = async () => {
    entered();
    await new Promise<void>((resolve) => (release = resolve));
  };
  const url = await start("bob");
  const callback = call(
    "/callback?state=" + url.searchParams.get("state") + "&code=race",
    "GET",
    undefined,
    "bob",
  );
  await waiting;
  assert.equal((await call("/disconnect", "POST", {}, "bob")).status, 200);
  release();
  assert.equal((await callback).status, 409);
  assert.equal(
    (await (await call("/status", "GET", undefined, "bob")).json()).connected,
    false,
  );
  tokenBarrier = null;
  expires = 1;
  await connect("bob");
  expires = 3600;
  let releaseRefresh!: () => void, enteredRefresh!: () => void;
  const started = new Promise<void>((resolve) => (enteredRefresh = resolve));
  tokenBarrier = async () => {
    enteredRefresh();
    await new Promise<void>((resolve) => (releaseRefresh = resolve));
  };
  const files = call("/files", "GET", undefined, "bob");
  await started;
  await call("/disconnect", "POST", {}, "bob");
  releaseRefresh();
  assert.equal((await files).status, 409);
  tokenBarrier = null;
  assert.equal(
    (await (await call("/status", "GET", undefined, "bob")).json()).connected,
    false,
  );
});
