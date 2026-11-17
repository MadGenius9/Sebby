import { useRef, useState } from "react";
import type { SourceImportReview } from "@shared/workspace/schema";
import { workspaceApi } from "./api";

export function SourceImportPanel({
  create,
  close,
  initialMode = "zip",
}: {
  create: (document: SourceImportReview["document"]) => Promise<void>;
  close: () => void;
  initialMode?: "zip" | "github";
}) {
  const [mode, setMode] = useState(initialMode);
  const [url, setUrl] = useState(""),
    [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState("Imported project");
  const [stripRoot, setStripRoot] = useState(true),
    [review, setReview] = useState<SourceImportReview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const invalidate = () => {
    generation.current++;
    setReview(null);
    setError("");
  };
  return (
    <section
      className="source-import-panel"
      aria-labelledby="source-import-title"
    >
      <h1 id="source-import-title">
        {mode === "zip" ? "Import source ZIP" : "Import GitHub source"}
      </h1>
      <p>
        Open a small source project as a new workspace. Review the file list
        before creating it.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if ((mode === "zip" && !file) || busy) return;
          setBusy(true);
          setError("");
          const request = generation.current;
          try {
            const result =
              mode === "zip"
                ? await workspaceApi.reviewSourceZip(file!, name, stripRoot)
                : await workspaceApi.reviewGithub(url, name, ref);
            if (request === generation.current) setReview(result);
          } catch (e) {
            if (request === generation.current) setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="import-source-kind">Source</label>
        <select
          id="import-source-kind"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            invalidate();
            setMode(e.target.value as "zip" | "github");
          }}
        >
          <option value="zip">ZIP file</option>
          <option value="github">Public GitHub repository</option>
        </select>
        {mode === "github" ? (
          <>
            <label htmlFor="github-source-url">GitHub repository URL</label>
            <input
              id="github-source-url"
              type="url"
              required
              value={url}
              placeholder="https://github.com/owner/repository"
              disabled={busy}
              onChange={(e) => {
                invalidate();
                setUrl(e.target.value);
              }}
            />
            <label htmlFor="github-source-ref">
              Branch, tag or commit (optional)
            </label>
            <input
              id="github-source-ref"
              value={ref}
              maxLength={160}
              placeholder="Default HEAD"
              disabled={busy}
              onChange={(e) => {
                invalidate();
                setRef(e.target.value);
              }}
            />
            <p>
              Public repositories only. The selected revision is resolved to a
              commit and downloaded as a source snapshot. No GitHub sign-in or
              repository write access is used.
            </p>
          </>
        ) : (
          <>
            <label htmlFor="source-zip">Source ZIP (up to 4 MB)</label>
            <input
              id="source-zip"
              type="file"
              accept=".zip,application/zip"
              required
              disabled={busy}
              onChange={(e) => {
                invalidate();
                const selected = e.target.files?.[0] || null;
                setFile(selected);
                if (selected)
                  setName(
                    selected.name.replace(/\.zip$/i, "").slice(0, 80) ||
                      "Imported project",
                  );
              }}
            />
          </>
        )}
        <label htmlFor="source-name">Project name</label>
        <input
          id="source-name"
          value={name}
          maxLength={80}
          required
          disabled={busy}
          onChange={(e) => {
            invalidate();
            setName(e.target.value);
          }}
        />
        {mode === "zip" && (
          <label className="source-import-check">
            <input
              type="checkbox"
              checked={stripRoot}
              disabled={busy}
              onChange={(e) => {
                invalidate();
                setStripRoot(e.target.checked);
              }}
            />{" "}
            Remove a shared outer folder
          </label>
        )}
        <p>
          Up to{" "}
          {mode === "github"
            ? "39 source files plus the origin record"
            : "40 UTF-8 source files"}
          , 100 KB per source file and 600 KB total. Binary assets,
          dependencies, generated folders and common credential filenames are
          excluded.
        </p>
        <div className="source-import-actions">
          <button
            className="btn btn--secondary"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Close
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={
              busy || (mode === "zip" ? !file : !url.trim()) || !name.trim()
            }
          >
            {busy
              ? "Working…"
              : mode === "zip"
                ? "Inspect ZIP"
                : "Inspect GitHub repository"}
          </button>
        </div>
      </form>
      {error && <p role="alert">{error}</p>}
      {review && (
        <div aria-live="polite">
          <h2>Review import</h2>
          <p>
            {review.document.files.length} source files ·{" "}
            {(review.totalBytes / 1000).toFixed(1)} KB ·{" "}
            {review.sourceRoot
              ? `Removed folder: ${review.sourceRoot}`
              : "Folder paths preserved"}
          </p>
          {review.source && (
            <section className="github-source-origin">
              <h3>Snapshot origin</h3>
              <p>{review.source.repository}</p>
              <p>
                Requested revision: <code>{review.source.requestedRef}</code>
              </p>
              <p>
                Commit: <code>{review.source.commit}</code>
              </p>
              <p>
                SEBBY-GITHUB-SOURCE.json records this origin. Later project
                edits can diverge from it.
              </p>
            </section>
          )}
          {review.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <details>
            <summary>Archive SHA-256</summary>
            <code>{review.archiveSha256}</code>
          </details>
          <h3>Included files</h3>
          <ul className="source-import-list">
            {review.document.files.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
          {!!review.skipped.length && (
            <details>
              <summary>{review.skipped.length} skipped files</summary>
              <ul className="source-import-list">
                {review.skipped.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code>
                    <span>{f.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await create(review.document);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create project from reviewed files
          </button>
        </div>
      )}
    </section>
  );
}
