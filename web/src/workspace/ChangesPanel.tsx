import { useEffect, useRef, useState } from "react";
import { workspaceApi, type Project } from "./api";
import type { RestoreReview } from "@shared/workspace/schema";
export function ChangesPanel({
  project,
  dirty,
  restore,
}: {
  project: Project;
  dirty: boolean;
  restore: (review: RestoreReview) => Promise<void>;
}) {
  const [revisions, setRevisions] = useState<
    { revision: number; createdAt: number; restoredFrom: number | null }[]
  >([]);
  const [from, setFrom] = useState(Math.max(1, project.revision - 1));
  const [result, setResult] = useState<{
    diff: string;
    sceneChanged: boolean;
    nameChanged: boolean;
  } | null>(null);
  const scope = useRef("");
  scope.current = JSON.stringify([project.id, project.revision, from, dirty]);
  const [review, setReview] = useState<RestoreReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
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
    setReview(null);
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
            aria-label="Compare from"
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          >
            {!revisions.some((r) => r.revision === from) && (
              <option value={from}>Revision {from}</option>
            )}
            {revisions.map((r) => (
              <option key={r.revision} value={r.revision}>
                Revision {r.revision}
                {r.restoredFrom ? ` · restored from ${r.restoredFrom}` : ""}
              </option>
            ))}
          </select>
        </label>
        {project.revision > 100 && (
          <label>
            Earlier revision number
            <input
              type="number"
              min={1}
              max={project.revision}
              value={from}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (
                  Number.isSafeInteger(value) &&
                  value > 0 &&
                  value <= project.revision
                )
                  setFrom(value);
              }}
            />
          </label>
        )}
        <span>to saved revision {project.revision}</span>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={
            dirty ||
            loading ||
            reviewing ||
            applying ||
            from >= project.revision
          }
          onClick={async () => {
            setReviewing(true);
            setError("");
            setReview(null);
            const expectedScope = scope.current;
            try {
              const prepared = await workspaceApi.restoreReview(
                project.id,
                project.revision,
                from,
              );
              if (scope.current === expectedScope) setReview(prepared);
            } catch (e) {
              if (scope.current === expectedScope)
                setError((e as Error).message);
            } finally {
              setReviewing(false);
            }
          }}
        >
          Review restoration
        </button>
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
      ) : loading || reviewing ? (
        <p className="panel-placeholder">
          {reviewing
            ? "Preparing restoration review…"
            : "Comparing saved files…"}
        </p>
      ) : review ? (
        <section
          className="restoration-review"
          aria-labelledby="restore-review-title"
        >
          <h2 id="restore-review-title">
            Restore revision {review.targetRevision}
          </h2>
          <p>
            Apply the changes below to saved revision {review.baseRevision}.
            This creates revision {review.baseRevision + 1} and keeps the
            existing history.
          </p>
          {review.nameChanged && (
            <p>
              Project name: {review.beforeName} → {review.afterName}
            </p>
          )}
          <pre className="diff-output" aria-label="Restoration source diff">
            {review.diff || "No source-file changes."}
          </pre>
          {review.sceneChanged && (
            <div className="restoration-scenes">
              <details>
                <summary>Current 3D scene</summary>
                <pre>{JSON.stringify(review.beforeScene, null, 2)}</pre>
              </details>
              <details>
                <summary>Restored 3D scene</summary>
                <pre>{JSON.stringify(review.afterScene, null, 2)}</pre>
              </details>
            </div>
          )}
          <p>
            Restores saved source, notes, scene and project name. Existing runs
            retain their original versions. Files already written to your
            computer or Drive need separate recovery.
          </p>
          {dirty && (
            <p>Save your manual edits and review again before restoring.</p>
          )}
          <div className="source-import-actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={applying}
              onClick={() => setReview(null)}
            >
              Close restoration review
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={
                dirty || applying || review.baseRevision !== project.revision
              }
              onClick={async () => {
                setApplying(true);
                setError("");
                try {
                  await restore(review);
                  setReview(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setApplying(false);
                }
              }}
            >
              {applying ? "Restoring…" : "Restore as new revision"}
            </button>
          </div>
        </section>
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
