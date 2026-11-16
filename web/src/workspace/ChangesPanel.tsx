import { useEffect, useState } from "react";
import { workspaceApi, type Project } from "./api";
export function ChangesPanel({
  project,
  dirty,
}: {
  project: Project;
  dirty: boolean;
}) {
  const [revisions, setRevisions] = useState<
    { revision: number; createdAt: number }[]
  >([]);
  const [from, setFrom] = useState(Math.max(1, project.revision - 1));
  const [result, setResult] = useState<{
    diff: string;
    sceneChanged: boolean;
    nameChanged: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    workspaceApi
      .revisions(project.id)
      .then((r) => {
        if (current) setRevisions(r.revisions);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [project.id, project.revision]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setResult(null);
    workspaceApi
      .diff(project.id, from, project.revision)
      .then((r) => {
        if (current) setResult(r);
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
  }, [project.id, project.revision, from]);
  return (
    <section className="changes-panel">
      <div className="panel-toolbar">
        <label>
          Compare from
          <select
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          >
            {revisions.map((r) => (
              <option key={r.revision} value={r.revision}>
                Revision {r.revision}
              </option>
            ))}
          </select>
        </label>
        <span>to saved revision {project.revision}</span>
      </div>
      {dirty && (
        <p className="workspace-note">
          Unsaved edits are excluded. Save to include them in the comparison.
        </p>
      )}
      {error ? (
        <p role="alert" className="workspace-message is-error">
          {error}
        </p>
      ) : loading ? (
        <p className="panel-placeholder">Comparing saved files…</p>
      ) : (
        result && (
          <>
            {result.sceneChanged && (
              <p className="workspace-message">
                The 3D scene changed between these revisions.
              </p>
            )}
            {result.nameChanged && (
              <p className="workspace-message">The project name changed.</p>
            )}
            <pre className="diff-output" aria-label="Saved source diff">
              {result.diff ||
                "No source file changes between these saved revisions."}
            </pre>
          </>
        )
      )}
    </section>
  );
}
