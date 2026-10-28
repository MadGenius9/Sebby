import { useState } from "react";
type Snapshot = {
  id: string;
  files: { path: string; bytes: number; sha256: string }[];
  totalBytes: number;
  snapshotHash: string;
  lockSha256: string;
};
type Config = {
  cliPath: string;
  cliSha256: string;
  daemonEndpoint: string;
  image: string;
};
type Status = {
  available: false;
  reason: string;
  configuration: Config | null;
  busy: boolean;
  snapshots: Snapshot[];
};
type API = {
  isolationStatus(): Promise<Status>;
  saveIsolationConfig(input: Config): Promise<unknown>;
  prepareIsolationSnapshot(input: { paths: string[] }): Promise<Snapshot>;
  verifyIsolationSnapshot(id: string): Promise<unknown>;
  discardIsolationSnapshot(id: string): Promise<unknown>;
};
export function IsolationPanel({ report }: { report: (s: string) => void }) {
  const api = (window as unknown as { sebby?: API }).sebby;
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false);
  const [paths, setPaths] = useState("package.json\npackage-lock.json"),
    [config, setConfig] = useState<Config>({
      cliPath: "",
      cliSha256: "",
      daemonEndpoint: "npipe:////./pipe/docker_engine",
      image: "",
    });
  const refresh = async () => {
    const value = await api!.isolationStatus();
    setStatus(value);
    if (value.configuration) setConfig(value.configuration);
  };
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch {
      report(
        "Isolation preparation failed. No build or test was run; check the selected files and local status.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="spaced" aria-label="Isolated build preparation">
      <h3>Isolated build preparation</h3>
      <p className="callout">
        Build and test execution is unavailable. This source checkpoint can
        prepare and verify a bounded local copy, but it has no enabled
        container/VM runner. No image downloads, software installs or project
        scripts run here.
      </p>
      {!api?.isolationStatus ? (
        <p>Local snapshot preparation requires the desktop app.</p>
      ) : (
        <>
          <button disabled={busy} onClick={() => void run(refresh)}>
            Refresh isolation preparation
          </button>
          <p>
            Engine: not validated · network disabled in proposed execution
            policy · no host-project writes
          </p>
          <label>
            Exact project files to copy, one relative path per line
            <textarea
              rows={5}
              value={paths}
              maxLength={24000}
              disabled={busy}
              onChange={(event) => setPaths(event.target.value)}
            />
          </label>
          <p className="muted">
            Include package.json and package-lock.json plus needed source. Up to
            100 files / 5 MiB; no links, hidden paths, node_modules or sensitive
            filenames. Filters cannot prove contents are secret-free. Copies are
            local and excluded from backups; normal quit discards session
            copies, but crashes may leave private staging files for manual
            review.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api!.prepareIsolationSnapshot({
                  paths: paths
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                });
                await refresh();
                report(
                  "Local snapshot prepared. No build or test was executed.",
                );
              })
            }
          >
            Review and prepare local snapshot
          </button>
          {status?.snapshots.map((item) => (
            <article key={item.id} className="task-card">
              <h4>
                Local snapshot · {item.files.length} files · {item.totalBytes}{" "}
                bytes
              </h4>
              <p>
                Digest: <code>{item.snapshotHash}</code>
              </p>
              <details>
                <summary>Copied paths and SHA-256 hashes</summary>
                <pre className="code-preview">
                  {JSON.stringify(item.files, null, 2)}
                </pre>
              </details>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api!.verifyIsolationSnapshot(item.id);
                    report(
                      "Snapshot files still match their recorded hashes. This does not verify an engine or execution.",
                    );
                  })
                }
              >
                Verify copied files
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api!.discardIsolationSnapshot(item.id);
                    await refresh();
                  })
                }
              >
                Discard local snapshot
              </button>
            </article>
          ))}
          <details>
            <summary>
              Future engine configuration (does not enable execution)
            </summary>
            <p>
              Only configure after reviewing an already available local engine
              and audited immutable image. Local daemon control can be
              privileged host access. No engine is contacted by saving these
              fields, and no tool is installed or pulled.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api!.saveIsolationConfig(config);
                  await refresh();
                });
              }}
            >
              {(
                [
                  ["cliPath", "Reviewed CLI absolute path"],
                  ["cliSha256", "Reviewed CLI SHA-256"],
                  ["daemonEndpoint", "Exact local daemon endpoint"],
                  ["image", "Audited image name@sha256:digest"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={config[key]}
                    maxLength={240}
                    disabled={busy}
                    onChange={(event) =>
                      setConfig((value) => ({
                        ...value,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <button disabled={busy}>
                Save unverified engine configuration
              </button>
            </form>
          </details>
          <button disabled>
            Run build/test — native engine validation required
          </button>
        </>
      )}
    </section>
  );
}
