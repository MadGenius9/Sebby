import { useState } from "react";
import type { Project } from "./api";
export function CodingPanel({
  project,
  update,
}: {
  project: Project;
  update: (p: Project) => void;
}) {
  const [selected, setSelected] = useState(project.files[0]?.path ?? "");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const file =
    project.files.find((f) => f.path === selected) ?? project.files[0];
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const p = path.trim();
    if (project.files.length >= 40) {
      setError("This workspace supports up to 40 files per project.");
      return;
    }
    if (
      !p ||
      p.length > 180 ||
      p.startsWith("/") ||
      p.includes("\\") ||
      !p
        .split("/")
        .every(
          (s) =>
            /^[a-zA-Z0-9_@.-]+$/.test(s) &&
            s !== "." &&
            s !== ".." &&
            ![".git", "node_modules"].includes(s.toLowerCase()),
        )
    ) {
      setError("Use a relative file path, such as src/app.ts.");
      return;
    }
    if (
      project.files.some((f) => {
        const a = f.path.toLowerCase(),
          b = p.toLowerCase();
        return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
      })
    ) {
      setError("That path conflicts with an existing file or folder.");
      return;
    }
    update({ ...project, files: [...project.files, { path: p, content: "" }] });
    setSelected(p);
    setPath("");
    setError("");
  };
  return (
    <div className="coding-layout">
      <aside className="file-panel">
        <h2>Files</h2>
        <div className="file-list">
          {project.files.map((f) => (
            <button
              key={f.path}
              type="button"
              className={file?.path === f.path ? "is-active" : ""}
              onClick={() => setSelected(f.path)}
            >
              {f.path}
            </button>
          ))}
        </div>
        <form onSubmit={add}>
          <label htmlFor="new-file">New file path</label>
          <input
            id="new-file"
            value={path}
            maxLength={180}
            placeholder="src/app.ts"
            onChange={(e) => setPath(e.target.value)}
          />
          <button className="btn btn--secondary" type="submit">
            Add file
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </aside>
      <section className="editor-panel" aria-label="Code editor">
        <div className="editor-title">
          {file?.path ?? "Choose a file"}
          <span>Plain text</span>
          {file && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${file.path}? You can undo this change before closing the project.`,
                  )
                )
                  update({
                    ...project,
                    files: project.files.filter((f) => f.path !== file.path),
                  });
              }}
            >
              Remove file
            </button>
          )}
        </div>
        {file && (
          <textarea
            aria-label={`Edit ${file.path}`}
            spellCheck={false}
            maxLength={100000}
            value={file.content}
            onChange={(e) =>
              update({
                ...project,
                files: project.files.map((f) =>
                  f.path === file.path ? { ...f, content: e.target.value } : f,
                ),
              })
            }
          />
        )}
        <p className="workspace-note">
          Files are stored with this project. Use Preview for saved browser
          code, Runs for build/test logs, and Changes to compare saved
          revisions.
        </p>
      </section>
    </div>
  );
}
