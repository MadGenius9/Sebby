import { IsolationPanel } from "./IsolationPanel";
import { ReviewedMcpPanel } from "./ReviewedMcpPanel";
import { GitHubPublishPanel } from "./GitHubPublishPanel";
import { PreviewPanel } from "./PreviewPanel";
import { GitHubPanel } from "./GitHubPanel";
import { useEffect, useState } from "react";
import { Folder, RefreshCw, Save, FileText, Lock, Check } from "lucide-react";
import { BackupPanel } from "./BackupPanel";
import { ConnectorBookmarks } from "./ConnectorBookmarks";
import { DevelopmentPanel } from "./DevelopmentPanel";
import { VoicePreview } from "./LocalPanels";
import {
  bridge,
  desktop,
  type State,
  type FileEntry,
  type Personality,
} from "./bridge";
type Props = {
  state: State;
  update: (s: State) => void;
  report: (s: string) => void;
};
export function Memory({ state, update, report }: Props) {
  const [value, setValue] = useState(state.memory),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setValue(state.memory);
    setSaved(false);
  }, [state.memory, state.workspace?.path]);
  return (
    <>
      <h2>A little context goes a long way.</h2>
      <p className="muted">
        Keep project goals, decisions, and working preferences here. You choose
        what Sebby remembers.
      </p>
      <div className="scope">
        <Folder size={17} />
        {state.workspace
          ? `Memory for ${state.workspace.name}`
          : "Personal memory · no workspace selected"}
      </div>
      <label className="field-label" htmlFor="memory">
        Your editable memory
      </label>
      <textarea
        id="memory"
        className="memory"
        maxLength={32000}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="What are we making? What matters? What should I keep in mind?"
      />
      <div className="action-row">
        <small className="muted">
          Stored locally as plain text. Don’t add passwords or API keys.
        </small>
        <button
          className="primary"
          onClick={async () => {
            try {
              update(await bridge.saveMemory(value));
              setSaved(true);
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          {saved ? <Check size={17} /> : <Save size={17} />}{" "}
          {saved ? "Saved" : "Save memory"}
        </button>
      </div>
      <BackupPanel report={report} />
    </>
  );
}
export function Workspace({
  state,
  choose,
  report,
}: {
  state: State;
  choose: () => void;
  report: (s: string) => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]),
    [selected, setSelected] = useState<{
      path: string;
      content: string;
    } | null>(null),
    [name, setName] = useState("project-brief.md"),
    [content, setContent] = useState(""),
    [message, setMessage] = useState("");
  async function refresh() {
    try {
      setFiles(await bridge.listFiles());
    } catch (e) {
      report((e as Error).message);
    }
  }
  useEffect(() => {
    setFiles([]);
    setSelected(null);
    if (state.workspace) void refresh();
  }, [state.workspace?.path]);
  return (
    <>
      <h2>A safe place to start.</h2>
      <p className="muted">
        Choose a project folder to browse supported text files and create a new
        note. Read files, create notes, or review explicit file changes below.
        No arbitrary terminal.
      </p>
      {!state.workspace ? (
        <div className="empty">
          <Folder size={42} />
          <h3>No folder selected</h3>
          <p>Your files stay untouched until you choose a workspace.</p>
          <button className="primary" onClick={choose}>
            Choose workspace
          </button>
        </div>
      ) : (
        <>
          <div className="scope">
            <Folder size={17} />
            <span>{state.workspace.path}</span>
            <button className="text-button" onClick={refresh}>
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
          <div className="file-browser">
            <div className="file-list" aria-label="Workspace files">
              {!files.length ? (
                <p className="muted">No supported text files found.</p>
              ) : (
                files.map((file) => (
                  <button
                    key={file.path}
                    className={selected?.path === file.path ? "selected" : ""}
                    onClick={async () => {
                      try {
                        setSelected(await bridge.readFile(file.path));
                      } catch (e) {
                        report((e as Error).message);
                      }
                    }}
                  >
                    <FileText size={15} />
                    <span>{file.path}</span>
                  </button>
                ))
              )}
            </div>
            <pre className="file-preview">
              {selected
                ? `${selected.path}\n\n${selected.content}`
                : "Select a file to read it.\n\nHidden files, dependency folders, symlinks, and unsupported extensions are excluded."}
            </pre>
          </div>
          <h3>Create a new project note</h3>
          <p className="muted">
            Only new .md or .txt files in the folder root. A native dialog will
            ask you to confirm.
          </p>
          <label className="field-label" htmlFor="filename">
            File name
          </label>
          <input
            id="filename"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label" htmlFor="note">
            Note content
          </label>
          <textarea
            id="note"
            className="note"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={32000}
          />
          <button
            className="primary"
            onClick={async () => {
              try {
                const result = await bridge.createNote({ name, content });
                setMessage(
                  result.created
                    ? `Created ${result.path}`
                    : "No file created.",
                );
                if (result.created) await refresh();
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            Review and create note
          </button>
          <p role="status">{message}</p>
          <DevelopmentPanel key={state.workspace.path} report={report} />
          <PreviewPanel report={report} />
          <IsolationPanel report={report} />
        </>
      )}
    </>
  );
}
export function Connections({ report }: { report: (s: string) => void }) {
  return (
    <>
      <h2>Connections, on your terms.</h2>
      <p className="muted">
        Configuration is not a live connection. External requests are optional,
        explicit and separately approved; nothing connects automatically.
      </p>
      {[
        [
          "AI provider",
          "Choose your provider, model and secure key source in Settings. Each paid chat or bounded specialist run needs approval.",
        ],
        [
          "GitHub",
          "Read repository metadata, a bounded tree or a selected text blob below. Publication below is separate: exact-repository authority, full diff review, new branches and draft PRs only. No clone, force push or merge.",
        ],
        [
          "Local tools",
          "Reviewed file edits and optional Git status are local features. Unity, Blender, spreadsheet tools, and autonomous agents are not controlled by Sebby yet.",
        ],
      ].map(([name, description]) => (
        <article className="connection" key={name}>
          <Lock size={21} />
          <div>
            <h3>{name}</h3>
            <p>{description}</p>
          </div>
          <span className="status">
            {desktop ? "Explicit actions only" : "Not connected"}
          </span>
        </article>
      ))}
      <div className="callout">
        <h3>Before we bring AI online</h3>
        <p>
          Secure credentials in the operating system key vault, choose a model
          and budget, then approve what context leaves this device. Never paste
          API keys into chat or project memory.
        </p>
      </div>
      <GitHubPanel report={report} />
      <GitHubPublishPanel report={report} />
      <ConnectorBookmarks report={report} />
      <ReviewedMcpPanel report={report} />
    </>
  );
}
export function PersonalityPanel({ state, update, report }: Props) {
  const [value, setValue] = useState<Personality>(state.personality),
    [saved, setSaved] = useState(false);
  return (
    <>
      <h2>Same Sebby. Your kind of company.</h2>
      <p className="muted">
        Set the tone for text chat. Saved preferences shape the chat
        instructions; specialist task roles and safety boundaries remain
        unchanged.
      </p>
      <div className="personality-preview">
        <img src="./orbit.png" alt="Sebby" />
        <div>
          <small>Personality preview · authored example, not AI</small>
          <h3>
            {value.warmth === "direct"
              ? "Let’s make a plan."
              : value.warmth === "warm"
                ? "Hey, I’m here. Let’s make something good."
                : "Ready when you are. What are we building?"}
          </h3>
          <p>
            {value.humor
              ? "Big ideas welcome. Scope creep gets its own chair."
              : "We’ll work in clear steps and check the results."}
          </p>
        </div>
      </div>
      <fieldset>
        <legend>Conversation style</legend>
        {(["balanced", "warm", "direct"] as const).map((tone) => (
          <label className="radio" key={tone}>
            <input
              type="radio"
              name="tone"
              checked={value.warmth === tone}
              onChange={() => {
                setValue({ ...value, warmth: tone });
                setSaved(false);
              }}
            />
            <span>{tone[0].toUpperCase() + tone.slice(1)}</span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={value.humor}
          onChange={(e) => {
            setValue({ ...value, humor: e.target.checked });
            setSaved(false);
          }}
        />
        A little light wit, when it fits
      </label>
      <button
        className="primary"
        onClick={async () => {
          try {
            update(await bridge.savePersonality(value));
            setSaved(true);
          } catch (e) {
            report((e as Error).message);
          }
        }}
      >
        <Save size={17} />
        {saved ? "Preferences saved" : "Save personality"}
      </button>
      <p className="muted">
        Always honest about limitations. Always asks before consequential
        actions.
      </p>
      <VoicePreview />
    </>
  );
}
