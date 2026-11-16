import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser, type AuthVars } from "../lib/auth.js";
import { ownedProject, revisionDocument, snapshot } from "./repository.js";
import type { RunRecord, RunnerStatus } from "./schema.js";
export type { RunRecord } from "./schema.js";
import { DockerRunner, type Runner, type RunCommand } from "./docker-runner.js";

db.exec(`CREATE TABLE IF NOT EXISTS workspace_runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, command TEXT NOT NULL, state TEXT NOT NULL, log TEXT NOT NULL DEFAULT '',
 snapshot_hash TEXT, snapshot_commit TEXT, runner_image TEXT, exit_code INTEGER, created_at INTEGER NOT NULL, finished_at INTEGER
); CREATE INDEX IF NOT EXISTS workspace_runs_project ON workspace_runs(project_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_runs_active ON workspace_runs(project_id) WHERE state IN ('preparing','running','stopping');`);
if (
  !(
    db.prepare("PRAGMA table_info(workspace_runs)").all() as { name: string }[]
  ).some((c) => c.name === "runner_image")
)
  db.exec("ALTER TABLE workspace_runs ADD COLUMN runner_image TEXT");
const activeStates = new Set(["preparing", "running", "stopping"]);
export const activeRun = (r: RunRecord) => activeStates.has(r.state);
const unpack = (r: any): RunRecord => ({
  id: r.id,
  projectId: r.project_id,
  revision: r.revision,
  command: r.command,
  state: r.state,
  log: r.log,
  snapshotHash: r.snapshot_hash,
  snapshotCommit: r.snapshot_commit,
  image: r.runner_image,
  exitCode: r.exit_code,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});
export const readRun = (id: string): RunRecord | null => {
  const r = db.prepare("SELECT * FROM workspace_runs WHERE id=?").get(id);
  return r ? unpack(r) : null;
};

export class RunService {
  private recovering = false;
  private closing = false;
  private active = new Map<
    string,
    {
      controller: AbortController;
      finished: Promise<void>;
      cause: "cancelled" | "timed_out" | "output_limit" | null;
    }
  >();
  constructor(
    private runner: Runner = new DockerRunner(),
    private timeoutMs = 120000,
    private logLimit = 64000,
  ) {}
  async status(): Promise<RunnerStatus> {
    return this.recovering || this.closing
      ? {
          available: false,
          backend: "docker" as const,
          reason: this.closing
            ? "Worker is shutting down"
            : "Recovering previous runs",
        }
      : this.runner.readiness();
  }
  async start(
    userId: string,
    projectId: string,
    revision: number,
    command: RunCommand,
  ) {
    if (!["build", "test"].includes(command))
      throw new RunError(400, "Unsupported run command");
    const project = ownedProject(userId, projectId);
    if (!project) throw new RunError(404, "Project not found");
    if (project.revision !== revision)
      throw new RunError(
        409,
        "Save and reopen the current project revision before starting a run.",
      );
    let pkg: any;
    try {
      pkg = JSON.parse(
        project.files.find((f) => f.path === "package.json")?.content || "",
      );
    } catch {
      throw new RunError(
        400,
        "Add a valid package.json before running commands.",
      );
    }
    if (
      !pkg ||
      typeof pkg !== "object" ||
      Array.isArray(pkg) ||
      typeof pkg.scripts?.[command] !== "string" ||
      !pkg.scripts[command].trim()
    )
      throw new RunError(400, `Add a ${command} script to package.json.`);
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = pkg[field];
      if (dependencies != null && (
        typeof dependencies !== "object" ||
        Array.isArray(dependencies) ||
        Object.keys(dependencies).length > 0
      )) {
        throw new RunError(400,
          "This runner currently supports dependency-free Node/npm projects. Dependency images and lockfile matching are not connected yet.",
        );
      }
    }
    const status = await this.status();
    if (!status.available) throw new RunError(503, status.reason);
    const id = randomUUID();
    db.transaction(() => {
      if (this.closing || this.recovering)
        throw new RunError(503, "Worker is not ready");
      const current = ownedProject(userId, projectId);
      if (!current || current.revision !== revision)
        throw new RunError(
          409,
          "Project changed while checking the runner. Reopen it before running.",
        );
      if (
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM workspace_runs WHERE state IN ('preparing','running','stopping')",
            )
            .get() as any
        ).n >= 2
      )
        throw new RunError(
          409,
          "The worker is busy. Wait for a running task to finish.",
        );
      if (
        db
          .prepare(
            "SELECT id FROM workspace_runs WHERE project_id=? AND state IN ('preparing','running','stopping')",
          )
          .get(projectId)
      )
        throw new RunError(409, "This project already has an active run.");
      if (
        db
          .prepare("SELECT id FROM workspace_runs WHERE state='cleanup_failed'")
          .get()
      )
        throw new RunError(
          503,
          "A previous container needs cleanup. Resolve it before starting more runs.",
        );
      db.prepare(
        "INSERT INTO workspace_runs(id,project_id,revision,command,state,created_at,runner_image) VALUES (?,?,?,?,?,?,?)",
      ).run(
        id,
        projectId,
        revision,
        command,
        "preparing",
        Date.now(),
        status.image || null,
      );
    })();
    const controller = new AbortController();
    const slot = {
      controller,
      finished: Promise.resolve(),
      cause: null as "cancelled" | "timed_out" | "output_limit" | null,
    };
    this.active.set(id, slot);
    slot.finished = this.perform(id, slot);
    return readRun(id)!;
  }
  private append(id: string, text: string) {
    const r = readRun(id)!;
    const log = (r.log + text).slice(0, this.logLimit);
    db.prepare("UPDATE workspace_runs SET log=? WHERE id=?").run(log, id);
    if (r.log.length + text.length > this.logLimit) {
      const slot = this.active.get(id);
      if (slot && !slot.cause) {
        slot.cause = "output_limit";
        slot.controller.abort();
      }
    }
  }
  private async perform(
    id: string,
    slot: {
      controller: AbortController;
      cause: "cancelled" | "timed_out" | "output_limit" | null;
    },
  ) {
    const timer = setTimeout(() => {
      if (!slot.cause) {
        slot.cause = "timed_out";
        slot.controller.abort();
        db.prepare("UPDATE workspace_runs SET state='stopping' WHERE id=?").run(
          id,
        );
      }
    }, this.timeoutMs);
    let executing = false;
    try {
      const r = readRun(id)!;
      const document = revisionDocument(r.projectId, r.revision);
      if (!document) throw new Error("Saved revision was not found");
      const source = await snapshot(document, id);
      db.prepare(
        "UPDATE workspace_runs SET snapshot_hash=?,snapshot_commit=? WHERE id=?",
      ).run(source.hash, source.commit, id);
      if (slot.controller.signal.aborted) {
        db.prepare(
          "UPDATE workspace_runs SET state=?,finished_at=? WHERE id=?",
        ).run(slot.cause || "cancelled", Date.now(), id);
        return;
      }
      db.prepare("UPDATE workspace_runs SET state='running' WHERE id=?").run(
        id,
      );
      executing = true;
      const result = await this.runner.execute(
        id,
        document,
        r.command,
        slot.controller.signal,
        (text) => this.append(id, text),
      );
      if (result.error) this.append(id, `\nRunner error: ${result.error}\n`);
      const state = !result.cleanupVerified
        ? "cleanup_failed"
        : slot.cause ||
          (result.exitCode === 0 && !result.error ? "succeeded" : "failed");
      db.prepare(
        "UPDATE workspace_runs SET state=?,exit_code=?,finished_at=? WHERE id=?",
      ).run(state, result.exitCode, Date.now(), id);
    } catch (e) {
      this.append(id, `\nPreparation error: ${(e as Error).message}\n`);
      db.prepare(
        "UPDATE workspace_runs SET state=?,finished_at=? WHERE id=?",
      ).run(
        executing && !(await this.runner.cleanup(id).catch(() => false))
          ? "cleanup_failed"
          : slot.cause || "failed",
        Date.now(),
        id,
      );
    } finally {
      clearTimeout(timer);
      this.active.delete(id);
    }
  }
  cancel(id: string) {
    const r = readRun(id);
    if (!r) return null;
    const slot = this.active.get(id);
    if (slot && !slot.cause) {
      slot.cause = "cancelled";
      db.prepare("UPDATE workspace_runs SET state='stopping' WHERE id=?").run(
        id,
      );
      slot.controller.abort();
    }
    return readRun(id);
  }
  async wait(id: string) {
    await this.active.get(id)?.finished;
    return readRun(id);
  }
  async recover() {
    this.recovering = true;
    try {
      const rows = db
        .prepare(
          "SELECT * FROM workspace_runs WHERE state IN ('preparing','running','stopping','cleanup_failed')",
        )
        .all() as any[];
      for (const row of rows) {
        const ok = await this.runner.cleanup(row.id).catch(() => false);
        db.prepare(
          "UPDATE workspace_runs SET state=?,finished_at=? WHERE id=?",
        ).run(ok ? "interrupted" : "cleanup_failed", Date.now(), row.id);
      }
    } finally {
      this.recovering = false;
    }
  }
  async shutdown() {
    this.closing = true;
    const all = [...this.active.entries()];
    for (const [id] of all) this.cancel(id);
    await Promise.allSettled(all.map(([, s]) => s.finished));
  }
}
export class RunError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}
export const runService = new RunService();
const startSchema = z
  .object({
    revision: z.number().int().positive(),
    command: z.enum(["build", "test"]),
  })
  .strict();
export function createRunsApi(service: RunService) {
  const app = new Hono<AuthVars>();
  app.use("*", requireUser);
  app.use(
    "*",
    bodyLimit({
      maxSize: 16000,
      onError: (c) => c.json({ error: "Run request is too large" }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (
      c.req.method !== "GET" &&
      origin &&
      origin !== new URL(c.req.url).origin
    )
      return c.json({ error: "Cross-origin write refused" }, 403);
    await next();
  });
  app.get("/runtime", async (c) => c.json(await service.status()));
  app.get("/:projectId/runs", (c) => {
    if (!ownedProject(c.get("user").id, c.req.param("projectId")))
      return c.json({ error: "Project not found" }, 404);
    return c.json({
      runs: db
        .prepare(
          "SELECT * FROM workspace_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 20",
        )
        .all(c.req.param("projectId"))
        .map(unpack),
    });
  });
  app.post("/:projectId/runs", async (c) => {
    const parsed = startSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: "Choose build or test with the saved revision" },
        400,
      );
    try {
      return c.json(
        {
          run: await service.start(
            c.get("user").id,
            c.req.param("projectId"),
            parsed.data.revision,
            parsed.data.command,
          ),
        },
        202,
      );
    } catch (e) {
      if (e instanceof RunError) return c.json({ error: e.message }, e.status);
      throw e;
    }
  });
  const allowed = (userId: string, id: string) => {
    const r = readRun(id);
    return r && ownedProject(userId, r.projectId) ? r : null;
  };
  app.get("/runs/:id", (c) => {
    const r = allowed(c.get("user").id, c.req.param("id"));
    return r ? c.json({ run: r }) : c.json({ error: "Run not found" }, 404);
  });
  app.post("/runs/:id/cancel", (c) => {
    if (!allowed(c.get("user").id, c.req.param("id")))
      return c.json({ error: "Run not found" }, 404);
    return c.json({ run: service.cancel(c.req.param("id")) });
  });
  app.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!allowed(c.get("user").id, id))
      return c.json({ error: "Run not found" }, 404);
    return streamSSE(c, async (stream) => {
      let last = "";
      while (!stream.aborted) {
        const run = readRun(id);
        if (!run) break;
        const data = JSON.stringify({ run });
        if (data !== last) {
          await stream.writeSSE({ event: "run", data });
          last = data;
        }
        if (!activeRun(run)) break;
        await stream.sleep(350);
      }
    });
  });
  return app;
}
export const runsApi = createRunsApi(runService);
