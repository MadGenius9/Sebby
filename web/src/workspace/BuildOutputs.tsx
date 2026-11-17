import { useEffect, useState } from "react";
import type {
  RunRecord,
  BuildManifest,
  BuildPreview,
} from "@shared/workspace/schema";
import { workspaceApi } from "./api";
export function BuildOutputs({ run }: { run: RunRecord }) {
  const [manifest, setManifest] = useState<BuildManifest | null>(null),
    [preview, setPreview] = useState<BuildPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setManifest(null);
    setPreview(null);
    setError("");
    if (run.artifactState === "ready")
      workspaceApi
        .buildManifest(run.id)
        .then((r) => {
          if (current) setManifest(r.manifest);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [run.id, run.artifactState]);
  if (run.command !== "build") return null;
  return (
    <section className="build-outputs">
      <header>
        <h2>Build outputs</h2>
        <span>{run.artifactState.replaceAll("_", " ")}</span>
      </header>
      {error && (
        <p className="workspace-message is-error" role="alert">
          {error}
        </p>
      )}
      {manifest ? (
        <>
          <p className="workspace-note">
            Saved revision {manifest.revision} · {manifest.files.length} files ·{" "}
            {(manifest.totalBytes / 1024).toFixed(1)} KB ·{" "}
            {manifest.outputDirectory}/
          </p>
          <div className="build-output-actions">
            <a
              className="btn btn--secondary"
              href={`/api/workspace/runs/${run.id}/outputs.zip`}
              download
            >
              Download build ZIP
            </a>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={!manifest.previewCandidate || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setPreview(await workspaceApi.buildPreview(run.id));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Preparing preview…" : "Preview saved build"}
            </button>
          </div>
          <p className="workspace-note">
            A collected build is not a verified working app. This preview
            supports self-contained static frontends and does not run backend
            code.
          </p>
          <details>
            <summary>Inspect build files</summary>
            <ul className="build-file-list">
              {manifest.files.map((f) => (
                <li key={f.path}>
                  <a
                    href={`/api/workspace/runs/${run.id}/output-file?path=${encodeURIComponent(f.path)}`}
                    download
                  >
                    {f.path}
                  </a>
                  <span>{f.bytes} bytes</span>
                  <code title={f.sha256}>{f.sha256.slice(0, 12)}</code>
                </li>
              ))}
            </ul>
          </details>
          {preview && (
            <>
              <p className="workspace-note">
                Sandbox preview · revision {preview.revision} · visual
                verification pending
              </p>
              <iframe
                title="Saved build preview"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={preview.html}
              />
              <ul className="preview-warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="workspace-note">
          {run.artifactState === "absent"
            ? "The build completed without files in its configured output folder."
            : run.artifactState === "withheld"
              ? "Outputs are unavailable because the run failed, was interrupted, or cleanup was not verified."
              : run.artifactState === "pending"
                ? "Outputs are collected after the build command exits successfully."
                : "No retained outputs are recorded for this run."}
        </p>
      )}
    </section>
  );
}
