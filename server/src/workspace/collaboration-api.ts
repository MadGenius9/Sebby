import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser, type AuthVars } from "../lib/auth.js";
import { ownedProject } from "./repository.js";
import {
  WorkspaceError,
  bindAgent,
  unbindAgent,
  bindingFor,
  listProposals,
  reviewProposal,
  applyProposal,
  rejectProposal,
} from "./collaboration.js";
export const collaborationApi = new Hono<AuthVars>();
collaborationApi.use("*", requireUser);
collaborationApi.use(
  "*",
  bodyLimit({
    maxSize: 16000,
    onError: (c) => c.json({ error: "Request too large" }, 413),
  }),
);
collaborationApi.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && origin && origin !== new URL(c.req.url).origin)
    return c.json({ error: "Cross-origin write refused" }, 403);
  await next();
});
collaborationApi.onError((e, c) =>
  e instanceof WorkspaceError
    ? c.json({ error: e.message }, e.status)
    : (console.error("[workspace collaboration]", e),
      c.json({ error: "Could not complete the project operation" }, 500)),
);
collaborationApi.get("/:projectId/agents", (c) => {
  const user = c.get("user").id,
    project = c.req.param("projectId");
  if (!ownedProject(user, project))
    throw new WorkspaceError(404, "Project not found");
  const agents = (
    db
      .prepare("SELECT * FROM bots WHERE user_id=? ORDER BY created_at")
      .all(user) as any[]
  )
    .filter((b) => b.kind !== "room" && !b.hidden)
    .map((b) => ({
      id: b.id,
      name: b.name,
      label: b.label,
      model: b.model,
      provider: b.provider,
      binding: bindingFor(user, b.id),
    }));
  return c.json({ agents });
});
collaborationApi.put("/:projectId/agents/:botId", async (c) => {
  const parsed = z
    .object({ allowRuns: z.boolean() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw new WorkspaceError(
      400,
      "Choose whether the agent may run builds/tests",
    );
  return c.json({
    binding: bindAgent(
      c.get("user").id,
      c.req.param("projectId"),
      c.req.param("botId"),
      parsed.data.allowRuns,
    ),
  });
});
collaborationApi.delete("/:projectId/agents/:botId", (c) => {
  unbindAgent(c.get("user").id, c.req.param("projectId"), c.req.param("botId"));
  return c.json({ ok: true });
});
collaborationApi.get("/:projectId/proposals", (c) =>
  c.json({
    proposals: listProposals(c.get("user").id, c.req.param("projectId")),
  }),
);
collaborationApi.get("/proposals/:id", async (c) =>
  c.json(await reviewProposal(c.get("user").id, c.req.param("id"))),
);
collaborationApi.post("/proposals/:id/apply", async (c) => {
  const parsed = z
    .object({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw new WorkspaceError(400, "Review the exact proposal before applying");
  return c.json({
    project: applyProposal(
      c.get("user").id,
      c.req.param("id"),
      parsed.data.reviewHash,
    ),
  });
});
collaborationApi.post("/proposals/:id/reject", (c) =>
  c.json({ proposal: rejectProposal(c.get("user").id, c.req.param("id")) }),
);
