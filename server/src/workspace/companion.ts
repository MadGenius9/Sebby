import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser, type AuthVars } from "../lib/auth.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const pathSchema = z
  .string()
  .min(1)
  .max(180)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      p
        .split("/")
        .every((s) => /^[A-Za-z0-9_@.-]+$/.test(s) && s !== "." && s !== ".."),
    "Use a relative source path",
  );
const taskSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list") }).strict(),
  z.object({ operation: z.literal("read"), path: pathSchema }).strict(),
  z
    .object({
      operation: z.literal("write"),
      path: pathSchema,
      content: z.string().max(100000),
      expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
db.exec(`CREATE TABLE IF NOT EXISTS workspace_companion_pairs(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_companions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,label TEXT NOT NULL,root_name TEXT NOT NULL,token_hash TEXT,writable INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_companion_jobs(id TEXT PRIMARY KEY,companion_id TEXT NOT NULL REFERENCES workspace_companions(id) ON DELETE CASCADE,request TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created_at INTEGER NOT NULL,finished_at INTEGER);`);
export const companionApi = new Hono<AuthVars>();
companionApi.use(
  "*",
  bodyLimit({
    maxSize: 900000,
    onError: (c) =>
      c.json({ error: "Companion payload exceeds its limit" }, 413),
  }),
);
companionApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && origin && origin !== new URL(c.req.url).origin)
    return c.json({ error: "Cross-origin write refused" }, 403);
  await next();
});
const safeParse = async <T>(c: any, schema: z.ZodType<T>) =>
  schema.safeParse(await c.req.json().catch(() => null));
const rowFor = (userId: string, id: string) =>
  db
    .prepare("SELECT * FROM workspace_companions WHERE user_id=? AND id=?")
    .get(userId, id) as any;
const device = (c: any) => {
  const auth = c.req.header("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return db
    .prepare(
      "SELECT * FROM workspace_companions WHERE token_hash=? AND created_at>?",
    )
    .get(hash(auth.slice(7)), Date.now() - 30 * 86400000) as any;
};
function expire() {
  db.prepare(
    "UPDATE workspace_companion_jobs SET state='expired',result=NULL,finished_at=? WHERE state IN ('queued','running') AND created_at<?",
  ).run(Date.now(), Date.now() - 60000);
  db.prepare(
    "UPDATE workspace_companion_jobs SET request='{}',result=NULL WHERE finished_at<?",
  ).run(Date.now() - 600000);
}
companionApi.post("/device/pair", async (c) => {
  const p = await safeParse(
    c,
    z
      .object({
        code: z.string().min(40).max(100),
        label: z.string().trim().min(1).max(80),
        rootName: z.string().trim().min(1).max(80),
        writable: z.boolean(),
      })
      .strict(),
  );
  if (!p.success) return c.json({ error: "Invalid pairing request" }, 400);
  const pair = db
    .prepare(
      "SELECT * FROM workspace_companion_pairs WHERE hash=? AND expires_at>?",
    )
    .get(hash(p.data.code), Date.now()) as any;
  if (!pair)
    return c.json({ error: "Pairing code expired or was already used" }, 403);
  const token = randomBytes(32).toString("base64url"),
    id = randomUUID();
  db.transaction(() => {
    const deleted = db
      .prepare("DELETE FROM workspace_companion_pairs WHERE hash=?")
      .run(hash(p.data.code));
    if (!deleted.changes) throw new Error("Pairing code was already used");
    db.prepare("INSERT INTO workspace_companions VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      pair.user_id,
      p.data.label,
      p.data.rootName,
      hash(token),
      p.data.writable ? 1 : 0,
      Date.now(),
      Date.now(),
    );
  })();
  return c.json({ id, token, expiresAt: Date.now() + 30 * 86400000 }, 201);
});
companionApi.post("/device/poll", (c) => {
  const row = device(c);
  if (!row) return c.json({ error: "Device is revoked or unauthorized" }, 401);
  expire();
  db.prepare("UPDATE workspace_companions SET last_seen=? WHERE id=?").run(
    Date.now(),
    row.id,
  );
  const job = db.transaction(() => {
    const active = db
      .prepare(
        "SELECT id FROM workspace_companion_jobs WHERE companion_id=? AND state='running'",
      )
      .get(row.id);
    if (active) return null;
    const candidate = db
      .prepare(
        "SELECT id,request FROM workspace_companion_jobs WHERE companion_id=? AND state='queued' ORDER BY created_at LIMIT 1",
      )
      .get(row.id) as any;
    if (!candidate) return null;
    db.prepare(
      "UPDATE workspace_companion_jobs SET state='running' WHERE id=? AND state='queued'",
    ).run(candidate.id);
    return { id: candidate.id, ...JSON.parse(candidate.request) };
  })();
  return c.json({ job });
});
companionApi.post("/device/result/:id", async (c) => {
  const row = device(c);
  if (!row) return c.json({ error: "Device is revoked or unauthorized" }, 401);
  expire();
  const parsed = await safeParse(
    c,
    z.union([
      z.object({ ok: z.literal(false), error: z.string().max(400) }).strict(),
      z
        .object({
          ok: z.literal(true),
          files: z.array(pathSchema).max(200),
          truncated: z.boolean(),
        })
        .strict(),
      z
        .object({
          ok: z.literal(true),
          path: pathSchema,
          content: z.string().max(100000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      z
        .object({
          ok: z.literal(true),
          path: pathSchema,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ]),
  );
  if (!parsed.success)
    return c.json({ error: "Invalid companion result" }, 400);
  const job = db
    .prepare(
      "SELECT request FROM workspace_companion_jobs WHERE id=? AND companion_id=? AND state='running'",
    )
    .get(c.req.param("id"), row.id) as any;
  if (!job) return c.json({ error: "Task is no longer active" }, 409);
  const request = JSON.parse(job.request),
    result = parsed.data;
  if (result.ok) {
    if ((request.operation === "list") !== "files" in result)
      return c.json({ error: "Result does not match task" }, 400);
    if (
      request.operation !== "list" &&
      (!("path" in result) || result.path !== request.path)
    )
      return c.json({ error: "Result path does not match task" }, 400);
    if (
      request.operation === "read" &&
      (!("content" in result) || hash(result.content) !== result.sha256)
    )
      return c.json({ error: "Read integrity check failed" }, 400);
    if (
      request.operation === "write" &&
      (!("sha256" in result) ||
        "content" in result ||
        hash(request.content) !== result.sha256)
    )
      return c.json({ error: "Write integrity check failed" }, 400);
  }
  const changed = db
    .prepare(
      "UPDATE workspace_companion_jobs SET state=?,result=?,finished_at=? WHERE id=? AND companion_id=? AND state='running'",
    )
    .run(
      result.ok ? "succeeded" : "failed",
      JSON.stringify(result),
      Date.now(),
      c.req.param("id"),
      row.id,
    );
  return changed.changes
    ? c.json({ ok: true })
    : c.json({ error: "Task expired" }, 409);
});
companionApi.use("*", requireUser);
companionApi.get("/", (c) => {
  expire();
  return c.json({
    companions: db
      .prepare(
        "SELECT id,label,root_name AS rootName,writable,created_at AS createdAt,last_seen AS lastSeen,token_hash IS NOT NULL AS active FROM workspace_companions WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(c.get("user").id),
  });
});
companionApi.post("/pairing", (c) => {
  const code = randomBytes(32).toString("base64url");
  db.prepare(
    "DELETE FROM workspace_companion_pairs WHERE user_id=? OR expires_at<?",
  ).run(c.get("user").id, Date.now());
  db.prepare("INSERT INTO workspace_companion_pairs VALUES(?,?,?)").run(
    hash(code),
    c.get("user").id,
    Date.now() + 300000,
  );
  return c.json({ code, expiresAt: Date.now() + 300000 });
});
companionApi.post("/:id/revoke", (c) => {
  const row = rowFor(c.get("user").id, c.req.param("id"));
  if (!row) return c.json({ error: "Companion not found" }, 404);
  db.transaction(() => {
    db.prepare(
      "UPDATE workspace_companions SET token_hash=NULL WHERE id=?",
    ).run(row.id);
    db.prepare(
      "UPDATE workspace_companion_jobs SET state='cancelled',result=NULL,request='{}',finished_at=? WHERE companion_id=? AND state IN ('queued','running')",
    ).run(Date.now(), row.id);
  })();
  return c.json({ ok: true });
});
companionApi.post("/:id/jobs", async (c) => {
  expire();
  const row = rowFor(c.get("user").id, c.req.param("id"));
  if (!row) return c.json({ error: "Companion not found" }, 404);
  if (
    !row.token_hash ||
    row.created_at < Date.now() - 30 * 86400000 ||
    row.last_seen < Date.now() - 15000
  )
    return c.json({ error: "Companion is offline or revoked" }, 409);
  const parsed = await safeParse(c, taskSchema);
  if (!parsed.success) return c.json({ error: "Invalid companion task" }, 400);
  if (parsed.data.operation === "write" && !row.writable)
    return c.json({ error: "This companion is read-only" }, 403);
  const pending = db
    .prepare(
      "SELECT COUNT(*) AS n FROM workspace_companion_jobs WHERE companion_id=? AND state IN ('queued','running')",
    )
    .get(row.id) as any;
  if (pending.n >= 5)
    return c.json({ error: "Companion task queue is full" }, 409);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO workspace_companion_jobs(id,companion_id,request,state,created_at) VALUES(?,?,?,'queued',?)",
  ).run(id, row.id, JSON.stringify(parsed.data), Date.now());
  return c.json({ id }, 202);
});
companionApi.get("/:id/jobs/:jobId", (c) => {
  expire();
  const row = rowFor(c.get("user").id, c.req.param("id"));
  if (!row) return c.json({ error: "Companion not found" }, 404);
  const job = db
    .prepare(
      "SELECT id,state,result FROM workspace_companion_jobs WHERE id=? AND companion_id=?",
    )
    .get(c.req.param("jobId"), row.id) as any;
  return job
    ? c.json({ ...job, result: job.result ? JSON.parse(job.result) : null })
    : c.json({ error: "Task not found" }, 404);
});
