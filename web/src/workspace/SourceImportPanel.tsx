import { useRef, useState } from "react";
import type { SourceImportReview } from "@shared/workspace/schema";
import { workspaceApi } from "./api";

export function SourceImportPanel({
  create,
  close,
}: {
  create: (document: SourceImportReview["document"]) => Promise<void>;
  close: () => void;
}) {
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
      <h1 id="source-import-title">Import source ZIP</h1>
      <p>
        Open a small source project as a new workspace. Review the file list
        before creating it.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file || busy) return;
          setBusy(true);
          setError("");
          const request = generation.current;
          try {
            const result = await workspaceApi.reviewSourceZip(
              file,
              name,
              stripRoot,
            );
            if (request === generation.current) setReview(result);
          } catch (e) {
            if (request === generation.current) setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
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
        <p>
          Up to 40 UTF-8 source files, 100 KB each and 600 KB total. Binary
          assets, dependencies, generated folders and common credential
          filenames are excluded.
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
            disabled={busy || !file || !name.trim()}
          >
            {busy ? "Working…" : "Inspect ZIP"}
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
