import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { requireUser, type AuthVars } from "../lib/auth.js";
import { ownedProject } from "./repository.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
export type DriveConfig = {
  clientId: string;
  clientSecret: string;
  key: string;
  serverUrl: string;
  appUrl: string;
  pickerKey: string;
  appId: string;
};
type Credentials = {
  access_token: string;
  refresh_token?: string;
  expiresAt: number;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function vault(key: string, userId: string, value?: string) {
  if (key.length < 32)
    throw new Error(
      "Drive requires a separate connector key of at least 32 characters",
    );
  const secret = createHash("sha256").update(key).digest();
  if (value !== undefined) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", secret, iv);
    cipher.setAAD(Buffer.from(userId));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  return (ciphertext: string) => {
    const data = Buffer.from(ciphertext, "base64"),
      decipher = createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  };
}
function seal(c: DriveConfig, id: string, value: unknown) {
  return vault(c.key, id, JSON.stringify(value)) as string;
}
function open(c: DriveConfig, id: string, value: string) {
  return JSON.parse((vault(c.key, id) as (v: string) => string)(value));
}
function configured(c: DriveConfig) {
  try {
    const server = new URL(c.serverUrl),
      app = new URL(c.appUrl);
    return (
      !!c.clientId &&
      !!c.clientSecret &&
      c.key.length >= 32 &&
      [server, app].every(
        (url) =>
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
      )
    );
  } catch {
    return false;
  }
}
class DriveError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 413 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS workspace_drive_connections(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,id TEXT NOT NULL,tokens TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_drive_states(state_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,verifier TEXT NOT NULL,created_at INTEGER NOT NULL);`);

export function createDriveApi(
  config: DriveConfig,
  fetcher: typeof fetch = fetch,
) {
  const app = new Hono<AuthVars>();
  app.use("*", requireUser);
  app.use("*", bodyLimit({ maxSize: 10000 }));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("origin");
    if (
      c.req.method !== "GET" &&
      origin &&
      origin !== new URL(c.req.url).origin
    )
      return c.json({ error: "Cross-origin write refused" }, 403);
    await next();
  });
  const connection = (userId: string) =>
    db
      .prepare("SELECT * FROM workspace_drive_connections WHERE user_id=?")
      .get(userId) as
      { id: string; tokens: string; created_at: number } | undefined;
  const requireConnection = (userId: string) => {
    if (!configured(config))
      throw new DriveError(503, "Drive is not configured on this server");
    const row = connection(userId);
    if (!row) throw new DriveError(409, "Connect Google Drive first");
    return row;
  };
  const current = (userId: string, id: string) => {
    if (connection(userId)?.id !== id)
      throw new DriveError(
        409,
        "Drive connection changed; reconnect and retry",
      );
  };
  async function bounded(response: Response, max: number) {
    if (Number(response.headers.get("content-length")) > max)
      throw new DriveError(413, "Drive response exceeds the import limit");
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > max)
          throw new DriveError(413, "Drive response exceeds the import limit");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
  }
  async function google(url: string, init: RequestInit = {}, max = 200000) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DriveError(502, "Google Drive could not be reached");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DriveError(
        response.status === 401 || response.status === 403 ? 403 : 502,
        "Google refused this Drive request. Reconnect or select an authorized file.",
      );
    }
    return bounded(response, max);
  }
  async function tokenRequest(params: Record<string, string>) {
    return JSON.parse(
      (
        await google(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              ...params,
              client_id: config.clientId,
              client_secret: config.clientSecret,
            }),
          },
          50000,
        )
      ).toString("utf8"),
    );
  }
  function parseTokens(raw: any, old?: Credentials): Credentials {
    const scopes =
      typeof raw.scope === "string" ? raw.scope.split(" ").filter(Boolean) : [];
    if (
      (!old && !scopes.includes(SCOPE)) ||
      scopes.some((s: string) => s !== SCOPE)
    )
      throw new DriveError(
        403,
        "Drive returned unexpected permissions; only selected-file access is accepted",
      );
    if (
      typeof raw.access_token !== "string" ||
      !raw.access_token ||
      raw.access_token.length > 10000 ||
      !Number.isFinite(raw.expires_in) ||
      raw.expires_in <= 0 ||
      raw.expires_in > 86400
    )
      throw new DriveError(502, "Google returned an invalid token response");
    if (
      raw.refresh_token !== undefined &&
      (typeof raw.refresh_token !== "string" ||
        raw.refresh_token.length > 10000)
    )
      throw new DriveError(502, "Google returned an invalid refresh token");
    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token || old?.refresh_token,
      expiresAt: Date.now() + raw.expires_in * 1000,
    };
  }
  async function authorized(userId: string) {
    const row = requireConnection(userId);
    let tokens: Credentials;
    try {
      tokens = open(config, userId, row.tokens);
    } catch {
      throw new DriveError(
        409,
        "Stored Drive credentials cannot be opened; disconnect and reconnect",
      );
    }
    if (tokens.expiresAt < Date.now() + 30000) {
      if (!tokens.refresh_token)
        throw new DriveError(409, "Drive authorization expired; reconnect");
      tokens = parseTokens(
        await tokenRequest({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        }),
        tokens,
      );
      const updated = db
        .prepare(
          "UPDATE workspace_drive_connections SET tokens=? WHERE user_id=? AND id=? AND tokens=?",
        )
        .run(seal(config, userId, tokens), userId, row.id, row.tokens);
      if (!updated.changes)
        throw new DriveError(
          409,
          "Drive connection changed during refresh; retry",
        );
    }
    current(userId, row.id);
    return { id: row.id, token: tokens.access_token };
  }
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof DriveError
            ? error.message
            : "Drive operation failed; reconnect and retry",
      },
      error instanceof DriveError ? error.status : 502,
    ),
  );
  app.get("/status", (c) =>
    c.json({
      configured: configured(config),
      connected: !!connection(c.get("user").id),
      scope: SCOPE,
      pickerConfigured: !!config.pickerKey && !!config.appId,
    }),
  );
  app.post("/connect", (c) => {
    if (!configured(config))
      throw new DriveError(
        503,
        "Configure the Google OAuth client and connector encryption key first",
      );
    const userId = c.get("user").id,
      state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url");
    db.prepare(
      "DELETE FROM workspace_drive_states WHERE user_id=? OR created_at<?",
    ).run(userId, Date.now() - 600000);
    db.prepare("INSERT INTO workspace_drive_states VALUES(?,?,?,?,?)").run(
      hash(state),
      userId,
      hash(getCookie(c, "grokbot_session") || ""),
      seal(config, userId, verifier),
      Date.now(),
    );
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.serverUrl.replace(/\/$/, "") + "/api/drive/callback",
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "false",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    return c.json({
      url: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
    });
  });
  app.get("/callback", async (c) => {
    if (!configured(config))
      throw new DriveError(503, "Drive is not configured");
    const userId = c.get("user").id,
      state = c.req.query("state") || "",
      code = c.req.query("code");
    const row = db
      .prepare(
        "SELECT * FROM workspace_drive_states WHERE state_hash=? AND user_id=? AND session_hash=?",
      )
      .get(
        hash(state),
        userId,
        hash(getCookie(c, "grokbot_session") || ""),
      ) as any;
    if (!row || !row.verifier || row.created_at < Date.now() - 600000)
      throw new DriveError(
        400,
        "Drive sign-in expired or belongs to another session",
      );
    const consumed = db
      .prepare(
        "UPDATE workspace_drive_states SET verifier='' WHERE state_hash=? AND verifier=?",
      )
      .run(hash(state), row.verifier);
    if (!consumed.changes)
      throw new DriveError(400, "Drive sign-in was already used");
    if (c.req.query("error") || !code || code.length > 10000)
      throw new DriveError(400, "Google Drive connection was not authorized");
    const raw = await tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: open(config, userId, row.verifier),
      redirect_uri: config.serverUrl.replace(/\/$/, "") + "/api/drive/callback",
    });
    const tokens = parseTokens(raw);
    // A disconnect during token exchange must not silently reconnect this user.
    const unchangedSession = await import("../lib/auth.js");
    if (
      unchangedSession.userFromCookieHeader(c.req.header("cookie"))?.id !==
      userId
    )
      throw new DriveError(403, "Sign in again before connecting Drive");
    db.transaction(() => {
      const pending = db
        .prepare(
          "DELETE FROM workspace_drive_states WHERE state_hash=? AND user_id=? AND verifier=''",
        )
        .run(hash(state), userId);
      if (!pending.changes)
        throw new DriveError(409, "Drive sign-in was cancelled or replaced");
      db.prepare(
        "INSERT INTO workspace_drive_connections VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,tokens=excluded.tokens,created_at=excluded.created_at",
      ).run(userId, randomUUID(), seal(config, userId, tokens), Date.now());
    })();
    return c.redirect(
      config.appUrl.replace(/\/$/, "") + "/workspace?drive=connected",
    );
  });
  app.post("/disconnect", async (c) => {
    const userId = c.get("user").id,
      row = connection(userId);
    db.prepare("DELETE FROM workspace_drive_connections WHERE user_id=?").run(
      userId,
    );
    db.prepare("DELETE FROM workspace_drive_states WHERE user_id=?").run(
      userId,
    );
    let revoked = !row;
    if (row) {
      try {
        const tokens: Credentials = open(config, userId, row.tokens);
        await google(
          "https://oauth2.googleapis.com/revoke",
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: tokens.refresh_token || tokens.access_token,
            }),
          },
          1000,
        );
        revoked = true;
      } catch {}
    }
    return c.json({ connected: false, revoked });
  });
  app.post("/picker-session", async (c) => {
    if (!config.pickerKey || !config.appId)
      throw new DriveError(
        503,
        "Configure the Google Picker API key and project number",
      );
    const auth = await authorized(c.get("user").id);
    return c.json({
      accessToken: auth.token,
      apiKey: config.pickerKey,
      appId: config.appId,
    });
  });
  app.get("/files", async (c) => {
    const userId = c.get("user").id,
      auth = await authorized(userId),
      params = new URLSearchParams({
        pageSize: "50",
        fields: "files(id,name,mimeType,modifiedTime,size),nextPageToken",
        q: "trashed = false",
        orderBy: "modifiedTime desc",
      });
    const token = c.req.query("pageToken");
    if (token) {
      if (token.length > 2000) throw new DriveError(400, "Invalid page token");
      params.set("pageToken", token);
    }
    const data = JSON.parse(
      (
        await google("https://www.googleapis.com/drive/v3/files?" + params, {
          headers: { authorization: "Bearer " + auth.token },
        })
      ).toString("utf8"),
    );
    current(userId, auth.id);
    return c.json({
      files: data.files || [],
      nextPageToken: data.nextPageToken || null,
    });
  });
  app.get("/files/:id/reference", async (c) => {
    const id = c.req.param("id");
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id))
      throw new DriveError(400, "Invalid Drive file ID");
    const userId = c.get("user").id,
      auth = await authorized(userId),
      headers = { authorization: "Bearer " + auth.token },
      url =
        "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id);
    const metadata = JSON.parse(
      (
        await google(
          url +
            "?fields=id,name,mimeType,modifiedTime,size,trashed,shortcutDetails",
          { headers },
        )
      ).toString("utf8"),
    );
    if (metadata.trashed || metadata.shortcutDetails)
      throw new DriveError(400, "Select a regular, non-trashed file");
    const isDoc = metadata.mimeType === "application/vnd.google-apps.document";
    if (
      !isDoc &&
      !["text/plain", "text/markdown", "text/csv", "application/json"].includes(
        metadata.mimeType,
      )
    )
      throw new DriveError(
        400,
        "This increment imports Google Docs and plain text, Markdown, CSV or JSON references",
      );
    if (Number(metadata.size) > 80000)
      throw new DriveError(413, "Drive references must be under 80 KB");
    const bytes = await google(
      url + (isDoc ? "/export?mimeType=text%2Fplain" : "?alt=media"),
      { headers },
      80000,
    );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DriveError(400, "Drive reference must contain UTF-8 text");
    }
    if (text.includes("\0"))
      throw new DriveError(400, "Binary references are unsupported");
    current(userId, auth.id);
    const sourceHash = createHash("sha256").update(bytes).digest("hex"),
      source = {
        provider: "google-drive",
        fileId: id,
        name: String(metadata.name).slice(0, 200),
        modifiedTime: metadata.modifiedTime || null,
        sha256: sourceHash,
      };
    return c.json({
      path: `references/drive-${id.length > 100 ? hash(id) : id}.md`,
      content:
        "# Imported Drive reference\n\nSource metadata (untrusted):\n" +
        JSON.stringify(source, null, 2) +
        "\n\n---\n\n" +
        text,
      source,
    });
  });
  app.post("/export", async (c) => {
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        revision: z.number().int().positive(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw new DriveError(400, "Choose a saved project revision");
    const userId = c.get("user").id,
      project = ownedProject(userId, parsed.data.projectId);
    if (!project) throw new DriveError(404, "Project not found");
    if (project.revision !== parsed.data.revision)
      throw new DriveError(
        409,
        "Save and reopen the latest project before exporting",
      );
    const auth = await authorized(userId),
      boundary = "sebby_" + randomBytes(16).toString("hex");
    const metadata = JSON.stringify({
        name: project.name + "-revision-" + project.revision + ".json",
        mimeType: "application/json",
      }),
      body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(project)}\r\n--${boundary}--`;
    const result = JSON.parse(
      (
        await google(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
          {
            method: "POST",
            headers: {
              authorization: "Bearer " + auth.token,
              "content-type": "multipart/related; boundary=" + boundary,
            },
            body,
          },
          50000,
        )
      ).toString("utf8"),
    );
    current(userId, auth.id);
    return c.json(
      {
        file: { id: result.id, name: result.name },
        revision: project.revision,
      },
      201,
    );
  });
  return app;
}
export const driveApi = createDriveApi({
  clientId: process.env.SEBBY_GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.SEBBY_GOOGLE_CLIENT_SECRET || "",
  key: process.env.SEBBY_CONNECTOR_KEY || "",
  serverUrl: env.serverUrl,
  appUrl: env.appUrl,
  pickerKey: process.env.SEBBY_GOOGLE_PICKER_KEY || "",
  appId: process.env.SEBBY_GOOGLE_APP_ID || "",
});
