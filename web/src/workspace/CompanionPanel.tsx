import { useEffect, useState, useRef } from "react";
import { documentSchema } from "@shared/workspace/schema";
import { workspaceApi, type Project } from "./api";
type Device = {
  id: string;
  label: string;
  rootName: string;
  writable: number;
  active: number;
  lastSeen: number;
  createdAt: number;
};
export function CompanionPanel({
  project,
  dirty,
  update,
}: {
  project: Project | null;
  dirty: boolean;
  update: (p: Project) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]),
    [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(
      null,
    ),
    [files, setFiles] = useState<string[]>([]),
    [deviceId, setDeviceId] = useState(""),
    [remote, setRemote] = useState<{
      path: string;
      content: string;
      sha256: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function refresh() {
    const result = await workspaceApi.companions();
    if (alive.current) setDevices(result.companions);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function task(id: string, payload: unknown) {
    const job = await workspaceApi.companionTask(id, payload);
    const end = Date.now() + 65000;
    while (alive.current && Date.now() < end) {
      const result = await workspaceApi.companionJob(id, job.id);
      if (result.state === "succeeded") return result.result;
      if (!["queued", "running"].includes(result.state))
        throw new Error(
          result.result?.error ||
            `Companion task ${result.state}. Check the computer before retrying a write.`,
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      "Companion task timed out. Check the computer before retrying.",
    );
  }
  const device = devices.find((d) => d.id === deviceId),
    localFile = project?.files.find((f) => f.path === remote?.path);
  return (
    <section className="drive-panel">
      <h2>My computer</h2>
      <p>
        Pair the companion running on your computer with one selected project
        folder. It starts read-only. Writes require the companion’s
        --allow-write option, an exact content check, and local backups. It does
        not run commands, delete files or create new files.
      </p>
      <div className="source-import-actions">
        <button
          className="btn btn--secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              setPair(await workspaceApi.companionPair());
            })
          }
        >
          Create pairing code
        </button>
        <button
          className="btn btn--secondary"
          type="button"
          disabled={busy}
          onClick={() => void act(refresh)}
        >
          Refresh computers
        </button>
      </div>
      {pair && (
        <section>
          <p>
            Pair within five minutes. Run from the Sebby repository on your
            computer, replacing the folder path:
          </p>
          <pre className="companion-command">
            node scripts/companion.mjs --server {location.origin} --root
            &quot;YOUR_PROJECT_FOLDER&quot; --code {pair.code}
          </pre>
          <p>
            Keep this one-time code private. Stop the companion with Ctrl+C, or
            revoke it below.
          </p>
        </section>
      )}
      <ul className="drive-file-list">
        {devices.map((d) => (
          <li key={d.id}>
            <span>
              {d.label} · {d.rootName} ·{" "}
              {d.active && Date.now() - d.createdAt < 30 * 86400000
                ? Date.now() - d.lastSeen < 15000
                  ? "Online"
                  : "Offline"
                : "Revoked/expired"}{" "}
              · {d.writable ? "Writes enabled locally" : "Read-only"}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy || !d.active}
              onClick={() =>
                void act(async () => {
                  setDeviceId(d.id);
                  setRemote(null);
                  const result = await task(d.id, { operation: "list" });
                  if (alive.current) {
                    setFiles(result.files);
                    setNotice(
                      result.truncated
                        ? "File list reached its limit; only the first source files are shown."
                        : "Source files listed.",
                    );
                  }
                })
              }
            >
              Browse source
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy || !d.active}
              onClick={() =>
                void act(async () => {
                  await workspaceApi.revokeCompanion(d.id);
                  if (deviceId === d.id) {
                    setFiles([]);
                    setRemote(null);
                  }
                  await refresh();
                })
              }
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {!!files.length && (
        <label>
          Source file
          <select
            aria-label="Computer source file"
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              const value = e.target.value;
              if (value)
                void act(async () => {
                  const result = await task(deviceId, {
                    operation: "read",
                    path: value,
                  });
                  if (alive.current) setRemote(result);
                });
            }}
          >
            <option value="">Choose a file</option>
            {files.map((p) => (
              <option value={p} key={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {remote && (
        <section className="drive-reference">
          <h3>Computer file: {remote.path}</h3>
          <pre>{remote.content}</pre>
          <div className="source-import-actions">
            <button
              className="btn btn--secondary"
              type="button"
              disabled={!project || busy}
              onClick={() => {
                if (!project) return;
                if (
                  project.files.some(
                    (f) => f.path.toLowerCase() === remote.path.toLowerCase(),
                  )
                ) {
                  setError(
                    "This project path already exists. Edit the existing source in Coding.",
                  );
                  return;
                }
                const next = {
                  ...project,
                  files: [
                    ...project.files,
                    { path: remote.path, content: remote.content },
                  ],
                };
                const parsed = documentSchema.safeParse({
                  name: next.name,
                  files: next.files,
                  scene: next.scene,
                });
                if (!parsed.success) {
                  setError(parsed.error.issues[0].message);
                  return;
                }
                if (new Blob([JSON.stringify(next)]).size > 900000) {
                  setError("File exceeds project save limits");
                  return;
                }
                update(next);
                setNotice(
                  "Computer source added to the project. Save to persist.",
                );
              }}
            >
              Add to project
            </button>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={
                !device?.writable ||
                !localFile ||
                dirty ||
                busy ||
                localFile.content === remote.content
              }
              onClick={() => {
                if (!localFile) return;
                if (
                  !window.confirm(
                    `Replace ${remote.path} on ${device?.label} with this project's saved content? The companion will back up the previous file.`,
                  )
                )
                  return;
                void act(async () => {
                  await task(deviceId, {
                    operation: "write",
                    path: remote.path,
                    content: localFile.content,
                    expectedHash: remote.sha256,
                  });
                  setRemote({
                    ...remote,
                    content: localFile.content,
                    sha256: "",
                  });
                  setNotice(
                    "Computer file updated. Read it again before another write.",
                  );
                });
              }}
            >
              Write saved project file to computer
            </button>
          </div>
          {localFile && localFile.content !== remote.content && (
            <details>
              <summary>Review replacement from saved project</summary>
              <pre>{localFile.content}</pre>
            </details>
          )}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
