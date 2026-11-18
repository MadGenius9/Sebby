import { Hono } from "hono";
import { requireUser, type AuthVars } from "../lib/auth.js";
import { buildManifest, buildZip, readBuildFiles } from "./artifacts.js";
import { compileBuildPreview } from "./artifact-preview.js";
export const artifactsApi = new Hono<AuthVars>();
artifactsApi.use("*", requireUser);
artifactsApi.onError((e, c) => {
  console.error("[build outputs]", e.message);
  return c.json({ error: "Build outputs could not be read safely" }, 500);
});
artifactsApi.get("/runs/:id/outputs", (c) => {
  const manifest = buildManifest(c.get("user").id, c.req.param("id"));
  return manifest
    ? c.json({ manifest })
    : c.json({ error: "Build outputs are not available" }, 404);
});
artifactsApi.get("/runs/:id/outputs.zip", (c) => {
  const id = c.req.param("id"),
    manifest = buildManifest(c.get("user").id, id);
  if (!manifest)
    return c.json({ error: "Build outputs are not available" }, 404);
  const zip = buildZip(c.get("user").id, id)!;
  c.header("content-type", "application/zip");
  c.header(
    "content-disposition",
    `attachment; filename="sebby-build-${id}.zip"`,
  );
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  c.header("x-sebby-manifest-sha256", manifest.manifestHash);
  return c.body(zip);
});
artifactsApi.get("/runs/:id/output-file", (c) => {
  const files = readBuildFiles(c.get("user").id, c.req.param("id"));
  const file = files?.find((f) => f.path === c.req.query("path"));
  if (!file) return c.json({ error: "Build file not found" }, 404);
  c.header("content-type", "application/octet-stream");
  c.header(
    "content-disposition",
    `attachment; filename="${file.path.split("/").pop()}"`,
  );
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  c.header("content-security-policy", "sandbox; default-src 'none'");
  return c.body(new Uint8Array(file.data));
});
artifactsApi.get("/runs/:id/build-preview", async (c) => {
  const id = c.req.param("id"),
    manifest = buildManifest(c.get("user").id, id);
  if (!manifest)
    return c.json({ error: "Build outputs are not available" }, 404);
  try {
    const preview = await compileBuildPreview(
      readBuildFiles(c.get("user").id, id)!,
    );
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
    return c.json({
      ...preview,
      runId: id,
      revision: manifest.revision,
      manifestHash: manifest.manifestHash,
      previewVerified: false,
    });
  } catch (e) {
    return c.json(
      {
        error: `Build preview unavailable: ${(e as Error).message.slice(0, 1000)}`,
      },
      422,
    );
  }
});
