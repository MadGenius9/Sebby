import { useEffect, useRef, useState } from "react";
import {
  KNOWLEDGE_KEY as KEY,
  readKnowledge,
  searchKnowledge,
  knowledgeExcerpt,
  knowledgeDraft,
  type KnowledgeNote as Note,
  type KnowledgeSource,
} from "./knowledge";
export { readKnowledge, searchKnowledge } from "./knowledge";
export function KnowledgePanel({
  useDraft,
}: {
  useDraft: (text: string) => void;
}) {
  const [state] = useState(() => {
    try {
      const serialized = localStorage.getItem(KEY);
      return {
        notes: readKnowledge(serialized || "[]"),
        error: "",
        serialized,
      };
    } catch {
      return {
        notes: [] as Note[],
        error:
          "Saved knowledge could not be loaded. Existing storage has not been overwritten.",
        serialized: null,
      };
    }
  });
  const [notes, setNotes] = useState(state.notes),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [source, setSource] = useState(""),
    [sourceKind, setSourceKind] = useState<KnowledgeSource["kind"]>("manual"),
    [deleting, setDeleting] = useState(false),
    [notice, setNotice] = useState(state.error),
    [dirty, setDirty] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const draftEpoch = useRef(0);
  const savedSnapshot = useRef(state.serialized);
  useEffect(
    () => () => {
      draftEpoch.current++;
    },
    [],
  );
  const matches = searchKnowledge(notes, query);
  function save(next: Note[]) {
    if (state.error)
      throw Error(
        "Saved knowledge is unreadable. Existing storage is protected; recover it before saving changes.",
      );
    const checked = readKnowledge(JSON.stringify(next));
    if (localStorage.getItem(KEY) !== savedSnapshot.current)
      throw Error(
        "Knowledge changed in another window. Reopen Knowledge before saving so those changes are preserved.",
      );
    const serialized = JSON.stringify(checked);
    localStorage.setItem(KEY, serialized);
    savedSnapshot.current = serialized;
    setNotes(checked);
  }
  function open(note?: Note) {
    if (dirty) {
      setNotice(
        "Save your current note before switching, or choose Discard draft.",
      );
      return;
    }
    draftEpoch.current++;
    setActive(note?.id || "");
    setTitle(note?.title || "");
    setBody(note?.text || "");
    setSource(note?.source?.label || "");
    setSourceKind(note?.source?.kind || "manual");
    setDeleting(false);
    setNotice("");
  }
  return (
    <section aria-label="Knowledge bank">
      <h2>Your second brain</h2>
      <p className="muted">
        Save notes, project decisions, and REA teardown reports. Search happens
        on this device. A note is sent to AI only when you add it to a chat
        draft and send that draft.
      </p>
      <p className="muted">
        Nothing is saved automatically. Source labels describe your evidence;
        Sebby does not fetch or verify them. Citations identify exact lines in
        the saved note revision.
      </p>
      {state.error && (
        <p role="alert">
          {state.error} Saving and deleting are disabled until the original
          storage is recovered.
        </p>
      )}
      <div className="button-row">
        <button className="secondary" onClick={() => open()}>
          New note
        </button>
        <button
          className="secondary"
          disabled={dirty}
          onClick={() => input.current?.click()}
        >
          Import text or teardown
        </button>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".txt,.md,.json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (dirty) {
            setNotice(
              "Save or discard the current draft before importing a report.",
            );
            return;
          }
          const operation = ++draftEpoch.current;
          try {
            if (file.size > 48000)
              throw Error("Choose a text report under 48 KB.");
            const text = await file.text();
            if (operation !== draftEpoch.current) return;
            if (text.includes("\0")) throw Error("Choose a plain-text report.");
            setActive("");
            setTitle(file.name.slice(0, 120));
            setBody(text);
            setSource(file.name.slice(0, 500));
            setSourceKind("import");
            setDeleting(false);
            setDirty(true);
            setNotice(
              "Report loaded into a draft. Save it to your knowledge bank.",
            );
          } catch (e) {
            if (operation === draftEpoch.current)
              setNotice((e as Error).message);
          }
        }}
      />
      <label className="field-label">
        Search knowledge
        <input
          aria-label="Search knowledge"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Project name, feature, or phrase…"
        />
      </label>
      <p>
        {matches.length} of {notes.length} notes
      </p>
      <div className="knowledge-grid">
        <div className="knowledge-list">
          {matches.map((note) => (
            <button
              key={note.id}
              className="secondary"
              aria-pressed={note.id === active}
              onClick={() => open(note)}
            >
              <strong>{note.title}</strong>
              <small>{note.text.slice(0, 130)}</small>
              <small>
                Source:{" "}
                {note.source?.label || "Personal note · source not recorded"}
              </small>
            </button>
          ))}
        </div>
        <div>
          <label className="field-label">
            Note title
            <input
              aria-label="Note title"
              value={title}
              maxLength={120}
              onChange={(e) => {
                draftEpoch.current++;
                setDeleting(false);
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="field-label">
            Source label (optional)
            <input
              aria-label="Source label"
              value={source}
              maxLength={500}
              placeholder="Original filename, document title, or URL (not fetched)"
              onChange={(e) => {
                draftEpoch.current++;
                setDeleting(false);
                setSource(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="field-label">
            Note content
            <textarea
              aria-label="Note content"
              className="note"
              value={body}
              maxLength={48000}
              onChange={(e) => {
                draftEpoch.current++;
                setDeleting(false);
                setBody(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={!!state.error || !title.trim() || !body.trim()}
              onClick={() => {
                try {
                  const id = active || crypto.randomUUID(),
                    note = {
                      id,
                      title: title.trim(),
                      text: body,
                      updated: Date.now(),
                      ...(source.trim()
                        ? { source: { kind: sourceKind, label: source.trim() } }
                        : {}),
                    };
                  save([...notes.filter((n) => n.id !== id), note]);
                  draftEpoch.current++;
                  setActive(id);
                  setDirty(false);
                  setDeleting(false);
                  setNotice("Note saved on this device.");
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              Save note
            </button>
            <button
              className="secondary"
              disabled={!dirty}
              onClick={() => {
                draftEpoch.current++;
                const note = notes.find((n) => n.id === active);
                setTitle(note?.title || "");
                setBody(note?.text || "");
                setSource(note?.source?.label || "");
                setSourceKind(note?.source?.kind || "manual");
                setDeleting(false);
                setDirty(false);
                setNotice("Draft discarded.");
              }}
            >
              Discard draft
            </button>
            <button
              className="secondary"
              disabled={dirty || !active || !!state.error}
              onClick={() => {
                const note = notes.find((n) => n.id === active);
                if (note && !dirty) useDraft(knowledgeDraft(note, query));
              }}
            >
              Use in chat draft
            </button>
            <button
              className="secondary"
              disabled={!active || dirty || !!state.error}
              onClick={() => setDeleting(true)}
            >
              Review note deletion
            </button>
          </div>
          {dirty && (
            <p className="muted">
              Save before creating a cited chat draft. Only the saved revision
              can be cited.
            </p>
          )}
          {active && !dirty && notes.find((n) => n.id === active) && (
            <details>
              <summary>Review cited excerpt</summary>
              <p>
                {
                  knowledgeExcerpt(
                    notes.find((n) => n.id === active)!,
                    query,
                  ).citation
                }
              </p>
              <pre className="file-preview">
                {
                  knowledgeExcerpt(
                    notes.find((n) => n.id === active)!,
                    query,
                  ).text
                }
              </pre>
              <p className="muted">
                A bounded excerpt near the first search match is added to your
                draft. Citation refers to this local note, not verified claims
                about an external source.
              </p>
            </details>
          )}
          {deleting && (
            <section aria-label="Confirm note deletion" className="callout">
              <p>
                Delete “{notes.find((n) => n.id === active)?.title}” from this
                device's knowledge bank? Original imported files and
                already-sent chat copies remain. There is no automatic backup or
                undo.
              </p>
              <button
                disabled={dirty || !!state.error}
                onClick={() => {
                  try {
                    save(notes.filter((n) => n.id !== active));
                    draftEpoch.current++;
                    setActive("");
                    setTitle("");
                    setBody("");
                    setSource("");
                    setDeleting(false);
                    setNotice(
                      "Note deleted from this knowledge bank. Original files and chat copies were not deleted.",
                    );
                  } catch (e) {
                    setNotice((e as Error).message);
                  }
                }}
              >
                Delete saved note
              </button>
              <button onClick={() => setDeleting(false)}>Keep note</button>
            </section>
          )}
        </div>
      </div>
      <p role="status">{notice}</p>
      <p className="muted">
        This bank uses local full-text search, not semantic embeddings. It is
        separate from app-data backups; keep your original reports. Importing a
        REA report does not run REA or rebuild an app.
      </p>
    </section>
  );
}
