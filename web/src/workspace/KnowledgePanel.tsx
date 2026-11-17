import { useState, useRef } from "react";
import { documentSchema } from "@shared/workspace/schema";
import type { KnowledgeHit } from "@shared/workspace/schema";
import { workspaceApi, type Project } from "./api";
const notes = [
  {
    path: "SEBBY.md",
    label: "Project brief",
    initial:
      "# Project brief\n\n## Goal\n\n## Constraints\n\n## Current task\n",
  },
  {
    path: "docs/requirements.md",
    label: "Requirements",
    initial: "# Requirements\n\n- \n",
  },
  {
    path: "docs/decisions.md",
    label: "Decision log",
    initial:
      "# Decisions\n\nRecord the date, decision, reason and source here.\n",
  },
];
export function KnowledgePanel({
  project,
  dirty,
  update,
}: {
  project: Project;
  dirty: boolean;
  update: (p: Project) => void;
}) {
  const [selected, setSelected] = useState(notes[0].path),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<KnowledgeHit[]>([]),
    [searched, setSearched] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const latest = useRef(project.revision);
  latest.current = project.revision;
  const file = project.files.find((f) => f.path === selected),
    definition = notes.find((n) => n.path === selected)!;
  function edit(content: string) {
    const next = {
      ...project,
      files: file
        ? project.files.map((f) =>
            f.path === selected ? { ...f, content } : f,
          )
        : [...project.files, { path: selected, content }],
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
    setError("");
    update(next);
  }
  return (
    <div className="knowledge-layout">
      <section className="knowledge-editor">
        <h1>Project brain</h1>
        <p>
          Keep your brief, requirements and decisions with the project. Assigned
          agents are instructed to read these saved files when starting work.
        </p>
        <nav aria-label="Project knowledge">
          {notes.map((n) => (
            <button
              className="btn btn--secondary"
              type="button"
              key={n.path}
              aria-pressed={selected === n.path}
              onClick={() => {
                setSelected(n.path);
                setError("");
              }}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <label htmlFor="knowledge-note">{selected}</label>
        {file ? (
          <textarea
            id="knowledge-note"
            value={file.content}
            maxLength={100000}
            onChange={(e) => edit(e.target.value)}
          />
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => edit(definition.initial)}
          >
            Create {definition.label.toLowerCase()}
          </button>
        )}
        <p>
          Use Save to persist notes. They appear in Coding, JSON exports and
          revision diffs. Keep credentials out of project files.
        </p>
      </section>
      <section className="knowledge-search">
        <h2>Search saved sources</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const revision = project.revision;
            try {
              const r = await workspaceApi.search(project.id, query);
              if (latest.current === revision) {
                setHits(r.hits);
                setSearched(r.revision);
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="knowledge-query">Keywords</label>
          <input
            id="knowledge-query"
            required
            minLength={2}
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="btn btn--secondary"
            type="submit"
            disabled={busy || dirty}
          >
            {busy ? "Searching…" : "Search saved project"}
          </button>
        </form>
        {dirty && <p>Save your edits before searching.</p>}
        {searched !== null && (
          <p>
            Saved revision {searched}
            {searched !== project.revision
              ? " · Results are from an earlier revision"
              : ""}{" "}
            · {hits.length} matches
          </p>
        )}
        {hits.map((h, i) => (
          <article key={`${h.path}:${i}`}>
            <h3>
              {h.path}:{h.startLine}–{h.endLine}
            </h3>
            <pre>{h.snippet}</pre>
            <details>
              <summary>Source hash</summary>
              <code>{h.sha256}</code>
            </details>
          </article>
        ))}
      </section>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
