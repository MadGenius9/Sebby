import { useEffect, useState } from "react";
import { workspaceApi, type Project } from "./api";
export function PreviewPanel({
  project,
  dirty,
}: {
  project: Project;
  dirty: boolean;
}) {
  const entries = project.files.filter((f) => f.path.endsWith(".html"));
  const [entry, setEntry] = useState(
    entries.find((f) => f.path === "index.html")?.path ||
      entries[0]?.path ||
      "",
  );
  const [preview, setPreview] = useState<{
    html: string;
    warnings: string[];
    revision: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setError("");
    setPreview(null);
    if (!entry || dirty) return;
    setLoading(true);
    workspaceApi
      .preview(project.id, entry)
      .then((p) => {
        if (current) setPreview(p);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [project.id, project.revision, entry, dirty, version]);
  return (
    <section className="preview-panel">
      <div className="panel-toolbar">
        <label>
          Entry file
          <select value={entry} onChange={(e) => setEntry(e.target.value)}>
            {entries.map((f) => (
              <option key={f.path}>{f.path}</option>
            ))}
          </select>
        </label>
        <button
          className="btn btn--secondary"
          type="button"
          disabled={dirty || !entry || loading}
          onClick={() => setVersion((v) => v + 1)}
        >
          Reload preview
        </button>
        <span>
          {preview ? `Saved revision ${preview.revision}` : "Browser preview"}
        </span>
      </div>
      <p className="workspace-note">
        Runs saved HTML, CSS, and JavaScript in a sandboxed frame. External
        resources and API fetches are restricted. This does not run server code
        or bundle module imports.
      </p>
      {dirty ? (
        <p className="panel-placeholder">
          Save your changes before opening the preview.
        </p>
      ) : !entry ? (
        <p className="panel-placeholder">
          Add an index.html file, or create a Web starter project.
        </p>
      ) : loading ? (
        <p className="panel-placeholder">Preparing preview…</p>
      ) : error ? (
        <p role="alert" className="workspace-message is-error">
          {error}
        </p>
      ) : (
        preview && (
          <>
            <iframe
              key={`${entry}-${project.revision}-${version}`}
              title="Project browser preview"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={preview.html}
            />
            {preview.warnings.length > 0 && (
              <ul className="preview-warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )
      )}
    </section>
  );
}
