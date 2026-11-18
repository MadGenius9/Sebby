import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireUser, type AuthVars } from "../lib/auth.js";
import { documentSchema, type SourceImportReview } from "./schema.js";
import { reviewSourceZip, SOURCE_IMPORT_LIMITS } from "./source-import.js";

const PROVENANCE_PATH = "SEBBY-GITHUB-SOURCE.json";
const inputSchema = z
  .object({
    url: z.string().min(1).max(300),
    name: documentSchema.shape.name,
    ref: z.string().trim().max(160).optional(),
  })
  .strict();
export type GithubImportInput = z.infer<typeof inputSchema>;
export class GithubImportError extends Error {
  constructor(
    public status: 400 | 404 | 413 | 429 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}
export function githubRepository(value: string) {
  // Parse only canonical HTTPS GitHub repository URLs, never arbitrary download URLs.
  if (
    value !== value.trim() ||
    value.includes("\\") ||
    !/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/?$/i.test(value)
  )
    throw new GithubImportError(
      400,
      "Use https://github.com/OWNER/REPO or its .git URL",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GithubImportError(400, "Enter a valid GitHub repository URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new GithubImportError(
      400,
      "Only public github.com repository URLs are supported",
    );
  const match = url.pathname.match(
    /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,104})\/?$/,
  );
  if (!match)
    throw new GithubImportError(
      400,
      "Use a repository URL with exactly OWNER/REPO",
    );
  const owner = match[1],
    repo = match[2].replace(/\.git$/i, "");
  if (repo.length > 100 || !repo || [".", ".."].includes(repo))
    throw new GithubImportError(400, "Invalid repository name");
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}
async function bytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new GithubImportError(
      413,
      "GitHub response exceeds the import size limit",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > max)
        throw new GithubImportError(
          413,
          "GitHub response exceeds the import size limit",
        );
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export async function reviewGithubRepository(
  input: GithubImportInput,
  fetcher: typeof fetch = fetch,
): Promise<SourceImportReview> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new GithubImportError(
      400,
      parsed.error.issues[0]?.message || "Invalid repository request",
    );
  const repository = githubRepository(parsed.data.url),
    ref = parsed.data.ref || "HEAD";
  if (
    !/^[A-Za-z0-9_.\/-]+$/.test(ref) ||
    ref.includes("..") ||
    ref
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"),
      ) ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.includes("//") ||
    ref.endsWith(".lock")
  )
    throw new GithubImportError(
      400,
      "Use a branch, tag or commit SHA without traversal",
    );
  const signal = AbortSignal.timeout(25000);
  const headers = {
    "User-Agent": "Sebby-Source-Importer",
    "X-GitHub-Api-Version": "2026-03-10",
    Accept: "application/vnd.github+json",
  };
  async function request(url: string, accept = headers.Accept) {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { ...headers, Accept: accept },
        redirect: "manual",
        signal,
        credentials: "omit",
      });
    } catch {
      throw new GithubImportError(
        502,
        "GitHub could not be reached or the download timed out",
      );
    }
    return response;
  }
  async function ok(response: Response) {
    if (response.ok) return;
    await response.body?.cancel();
    if (response.status === 404)
      throw new GithubImportError(
        404,
        "Public repository or revision not found. Private repositories are not supported.",
      );
    if (response.status === 403 || response.status === 429)
      throw new GithubImportError(
        429,
        "GitHub access or rate limit refused the request. Try again later.",
      );
    if (response.status >= 300 && response.status < 400)
      throw new GithubImportError(
        400,
        "Repository moved or redirected. Use its current canonical GitHub URL.",
      );
    throw new GithubImportError(502, "GitHub refused the source download");
  }
  const base = `https://api.github.com/repos/${repository.owner}/${repository.repo}`;
  const metadataResponse = await request(base);
  await ok(metadataResponse);
  let metadata: any;
  try {
    metadata = JSON.parse(
      (await bytes(metadataResponse, 100000)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof GithubImportError) throw error;
    throw new GithubImportError(
      502,
      "GitHub returned invalid repository metadata",
    );
  }
  if (
    metadata.private !== false ||
    String(metadata.full_name).toLowerCase() !==
      `${repository.owner}/${repository.repo}`.toLowerCase()
  )
    throw new GithubImportError(
      400,
      "Only the requested public repository can be imported",
    );
  if (metadata.disabled || metadata.empty)
    throw new GithubImportError(400, "This repository is disabled or empty");
  const commitResponse = await request(
    base + "/commits/" + encodeURIComponent(ref),
    "application/vnd.github.sha",
  );
  await ok(commitResponse);
  const commit = (await bytes(commitResponse, 1000)).toString("utf8").trim();
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new GithubImportError(502, "GitHub did not return a full commit SHA");
  const redirect = await request(base + "/zipball/" + commit);
  if (![301, 302, 303, 307, 308].includes(redirect.status)) {
    await ok(redirect);
    await redirect.body?.cancel();
    throw new GithubImportError(
      502,
      "GitHub did not return its archive location",
    );
  }
  const location = redirect.headers.get("location");
  await redirect.body?.cancel();
  let archive: URL;
  try {
    archive = new URL(location || "");
  } catch {
    throw new GithubImportError(
      502,
      "GitHub returned an invalid archive location",
    );
  }
  const expected = `/${repository.owner}/${repository.repo}/`;
  if (
    archive.protocol !== "https:" ||
    archive.hostname !== "codeload.github.com" ||
    archive.port ||
    archive.username ||
    archive.password ||
    archive.hash ||
    archive.search ||
    !archive.pathname.toLowerCase().startsWith(expected.toLowerCase()) ||
    !["zip/", "legacy.zip/"].some(
      (prefix) => archive.pathname.slice(expected.length) === prefix + commit,
    )
  )
    throw new GithubImportError(502, "GitHub archive redirect was refused");
  // No cookies, application tokens or request headers are forwarded to the archive host.
  let response: Response;
  try {
    response = await fetcher(archive.href, {
      redirect: "manual",
      signal,
      credentials: "omit",
      headers: { "User-Agent": "Sebby-Source-Importer" },
    });
  } catch {
    throw new GithubImportError(
      502,
      "GitHub archive download timed out or failed",
    );
  }
  await ok(response);
  const archiveBytes = await bytes(response, SOURCE_IMPORT_LIMITS.upload);
  let review: SourceImportReview;
  try {
    review = await reviewSourceZip(archiveBytes, parsed.data.name, true);
  } catch (error) {
    throw new GithubImportError(
      400,
      "Repository source cannot fit this workspace. " +
        ((error as Error).message.startsWith("[")
          ? "Source paths exceed project limits."
          : (error as Error).message
        ).slice(0, 200),
    );
  }
  const provenance = {
    provider: "github" as const,
    repository: repository.url,
    requestedRef: ref,
    commit,
    archiveSha256: review.archiveSha256,
  };
  if (review.document.files.length >= 40)
    throw new GithubImportError(
      400,
      "GitHub import supports up to 39 source files plus one provenance file",
    );
  const file = {
    path: PROVENANCE_PATH,
    content: JSON.stringify(provenance, null, 2) + "\n",
  };
  const document = documentSchema.safeParse({
    ...review.document,
    files: [...review.document.files, file],
  });
  if (!document.success)
    throw new GithubImportError(
      400,
      "Repository conflicts with the reserved GitHub provenance path",
    );
  if (Buffer.byteLength(JSON.stringify(document.data)) > 900000)
    throw new GithubImportError(
      413,
      "Project with provenance exceeds the save request limit",
    );
  if (
    review.totalBytes + Buffer.byteLength(file.content) >
    SOURCE_IMPORT_LIMITS.totalBytes
  )
    throw new GithubImportError(413, "Source plus provenance exceeds 600 KB");
  return {
    ...review,
    totalBytes: review.totalBytes + Buffer.byteLength(file.content),
    document: document.data,
    source: provenance,
    warnings: [
      ...review.warnings,
      "This is an editable commit snapshot. Git history, private access, syncing, submodules, LFS objects and pull requests are not included.",
    ],
  };
}

export function createGithubImportApi(fetcher: typeof fetch = fetch) {
  const app = new Hono<AuthVars>();
  let pending = 0;
  const owners = new Set<string>();
  app.use("*", requireUser);
  app.use(
    "*",
    bodyLimit({
      maxSize: 10000,
      onError: (c) =>
        c.json({ error: "Repository request exceeds 10 KB" }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("origin");
    if (
      c.req.method !== "GET" &&
      origin &&
      origin !== new URL(c.req.url).origin
    )
      return c.json({ error: "Cross-origin write refused" }, 403);
    await next();
  });
  app.post("/review", async (c) => {
    const parsed = inputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error:
            parsed.error.issues[0]?.message || "Invalid repository request",
        },
        400,
      );
    const owner = c.get("user").id;
    if (pending >= 2 || owners.has(owner))
      return c.json(
        {
          error:
            "Another repository import is being inspected. Try again shortly.",
        },
        429,
      );
    pending++;
    owners.add(owner);
    try {
      return c.json(await reviewGithubRepository(parsed.data, fetcher));
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof GithubImportError
              ? error.message
              : "Could not inspect the GitHub repository",
        },
        error instanceof GithubImportError ? error.status : 502,
      );
    } finally {
      pending--;
      owners.delete(owner);
    }
  });
  return app;
}
