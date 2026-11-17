import { searchProject } from "./knowledge.js";
import { reviewSourceZip } from "./source-import.js";
import { z } from "zod";
import { starter } from "./templates.js";
import { buildPreview } from "./preview.js";
import {
  ownedProject,
  rememberRevision,
  revisionDocument,
  revisionDiff,
} from "./repository.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { db } from "../db.js";
import { requireUser, type AuthVars } from "../lib/auth.js";
import { documentSchema, saveSchema, type Project } from "./schema.js";

type Stored = {
  id: string;
  name: string;
  document: string;
  revision: number;
  updated_at: number;
};
const unpack = (row: Stored): Project => ({
  ...JSON.parse(row.document),
  id: row.id,
  revision: row.revision,
  updatedAt: row.updated_at,
});
export const projectsApi = new Hono<AuthVars>();
projectsApi.use("*", requireUser);
projectsApi.use(
  "*",
  bodyLimit({
    maxSize: 4_000_000,
    onError: (c) =>
      c.json({ error: "Request exceeds the 4 MB upload limit" }, 413),
  }),
);
// Cookie-authenticated writes must originate from this app. No cross-origin API use.
projectsApi.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && origin && origin !== new URL(c.req.url).origin)
    return c.json({ error: "Cross-origin write refused" }, 403);
  await next();
});
// ZIP inspection has a separate upload cap; existing JSON project writes keep their limit.
const jsonLimit = bodyLimit({
  maxSize: 1_000_000,
  onError: (c) =>
    c.json({ error: "Project exceeds the 1 MB request limit" }, 413),
});
projectsApi.use("*", (c, next) =>
  c.req.path.endsWith("/import-source/review") ? next() : jsonLimit(c, next),
);
projectsApi.post("/import-source/review", async (c) => {
  if (
    !c.req.header("content-type")?.toLowerCase().startsWith("application/zip")
  )
    return c.json(
      { error: "Upload a ZIP with application/zip content type" },
      415,
    );
  const name = c.req.query("name") || "Imported project";
  if (!documentSchema.shape.name.safeParse(name).success)
    return c.json(
      { error: "Enter a project name between 1 and 80 characters" },
      400,
    );
  try {
    return c.json(
      await reviewSourceZip(
        Buffer.from(await c.req.arrayBuffer()),
        name,
        c.req.query("stripRoot") === "true",
      ),
    );
  } catch (error) {
    console.warn("Source ZIP refused:", (error as Error).message.slice(0, 240));
    return c.json(
      {
        error:
          "Could not import source ZIP. " +
          ((error as Error).message.startsWith("[")
            ? "Source paths or content exceed project limits."
            : (error as Error).message
          ).slice(0, 240),
      },
      400,
    );
  }
});
projectsApi.get("/", (c) => {
  const rows = db
    .prepare(
      "SELECT id,name,revision,updated_at FROM workspace_projects WHERE user_id=? ORDER BY updated_at DESC",
    )
    .all(c.get("user").id) as Stored[];
  return c.json({
    projects: rows.map((r) => ({
      id: r.id,
      name: r.name,
      revision: r.revision,
      updatedAt: r.updated_at,
    })),
  });
});
projectsApi.post("/", async (c) => {
  const parsed = documentSchema
    .pick({ name: true })
    .extend({ template: z.enum(["blank", "web"]).optional() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { error: "Enter a project name between 1 and 80 characters" },
      400,
    );
  const project = starter(parsed.data.name, parsed.data.template);
  const id = randomUUID(),
    updatedAt = Date.now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO workspace_projects(id,user_id,name,document,updated_at) VALUES (?,?,?,?,?)",
    ).run(
      id,
      c.get("user").id,
      project.name,
      JSON.stringify(project),
      updatedAt,
    );
    rememberRevision(id, 1, project);
  })();
  return c.json({ project: { ...project, id, revision: 1, updatedAt } }, 201);
});
projectsApi.get("/:id", (c) => {
  const row = db
    .prepare("SELECT * FROM workspace_projects WHERE id=? AND user_id=?")
    .get(c.req.param("id"), c.get("user").id) as Stored | undefined;
  return row
    ? c.json({ project: unpack(row) })
    : c.json({ error: "Project not found" }, 404);
});
projectsApi.put("/:id", async (c) => {
  const parsed = saveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project" },
      400,
    );
  const { revision, ...document } = parsed.data;
  const updatedAt = Date.now();
  const result = db.transaction(() => {
    const result = db
      .prepare(
        "UPDATE workspace_projects SET name=?,document=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
      )
      .run(
        document.name,
        JSON.stringify(document),
        updatedAt,
        c.req.param("id"),
        c.get("user").id,
        revision,
      );
    if (result.changes)
      rememberRevision(c.req.param("id"), revision + 1, document);
    return result;
  })();
  if (!result.changes) {
    const exists = db
      .prepare("SELECT id FROM workspace_projects WHERE id=? AND user_id=?")
      .get(c.req.param("id"), c.get("user").id);
    return exists
      ? c.json(
          {
            error:
              "This project changed in another tab. Export your work, then reopen the project before saving.",
          },
          409,
        )
      : c.json({ error: "Project not found" }, 404);
  }
  return c.json({
    project: {
      ...document,
      id: c.req.param("id"),
      revision: revision + 1,
      updatedAt,
    },
  });
});

projectsApi.get("/:id/revisions", (c) => {
  if (!ownedProject(c.get("user").id, c.req.param("id")))
    return c.json({ error: "Project not found" }, 404);
  return c.json({
    revisions: db
      .prepare(
        "SELECT revision,created_at AS createdAt FROM workspace_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 100",
      )
      .all(c.req.param("id")),
  });
});
projectsApi.get("/:id/diff", async (c) => {
  const project = ownedProject(c.get("user").id, c.req.param("id"));
  if (!project) return c.json({ error: "Project not found" }, 404);
  const from = Number(c.req.query("from")),
    to = Number(c.req.query("to") || project.revision);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1)
    return c.json({ error: "Choose saved revision numbers" }, 400);
  const before = revisionDocument(project.id, from),
    after = revisionDocument(project.id, to);
  if (!before || !after) return c.json({ error: "Revision not found" }, 404);
  try {
    return c.json(await revisionDiff(before, after));
  } catch {
    return c.json(
      {
        error:
          "Could not generate diff. Verify the saved file paths and server Git installation.",
      },
      503,
    );
  }
});

projectsApi.post("/import", async (c) => {
  const input = await c.req.json().catch(() => null);
  const parsed = documentSchema.safeParse(
    input && typeof input === "object"
      ? { name: input.name, files: input.files, scene: input.scene }
      : null,
  );
  if (!parsed.success)
    return c.json(
      { error: parsed.error.issues[0]?.message || "Invalid project export" },
      400,
    );
  const document = parsed.data,
    id = randomUUID(),
    updatedAt = Date.now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO workspace_projects(id,user_id,name,document,updated_at) VALUES (?,?,?,?,?)",
    ).run(
      id,
      c.get("user").id,
      document.name,
      JSON.stringify(document),
      updatedAt,
    );
    rememberRevision(id, 1, document);
  })();
  return c.json({ project: { ...document, id, revision: 1, updatedAt } }, 201);
});
projectsApi.get("/:id/preview", (c) => {
  const project = ownedProject(c.get("user").id, c.req.param("id"));
  if (!project) return c.json({ error: "Project not found" }, 404);
  try {
    return c.json({
      ...buildPreview(project, c.req.query("entry") || "index.html"),
      revision: project.revision,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

projectsApi.get("/:id/search", (c) => {
  const project = ownedProject(c.get("user").id, c.req.param("id"));
  if (!project) return c.json({ error: "Project not found" }, 404);
  const query = c.req.query("q") || "";
  if (query.length > 200)
    return c.json({ error: "Search query must be under 200 characters" }, 400);
  return c.json(searchProject(project, query));
});
