import { useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Clock,
  Trash2,
  FileText,
  Volume2,
  Square,
} from "lucide-react";
import {
  local,
  type Task,
  type Reminder,
  type Skill,
  type Conversation,
} from "./bridge";
type Props = { report: (message: string) => void };
function DesktopOnly() {
  return (
    <div className="callout">
      <h3>Available in the desktop app</h3>
      <p>
        This browser preview does not pretend to run desktop services. Launch
        Sebby with <code>npm start</code> to use these local features.
      </p>
    </div>
  );
}
export function TasksPanel({ report }: Props) {
  const [items, setItems] = useState<Task[]>([]),
    [title, setTitle] = useState(""),
    [prompt, setPrompt] = useState(""),
    [role, setRole] = useState("planner");
  async function load() {
    if (local)
      try {
        setItems(await local.listTasks());
      } catch (e) {
        report((e as Error).message);
      }
  }
  useEffect(() => {
    void load();
  }, []);
  if (!local) return <DesktopOnly />;
  return (
    <>
      <h2>Keep the next step in sight.</h2>
      <p className="muted">
        A durable queue for future specialist agents. Tasks are saved, not
        executed: the AI executor is not connected.
      </p>
      <div className="form-grid">
        <label>
          Task title
          <input
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Specialist role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="planner">Planner</option>
            <option value="coder">Coder</option>
            <option value="reviewer">Reviewer</option>
            <option value="researcher">Researcher</option>
          </select>
        </label>
      </div>
      <label className="field-label" htmlFor="task-prompt">
        What needs doing?
      </label>
      <textarea
        id="task-prompt"
        className="note"
        value={prompt}
        maxLength={16000}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="action-row">
        <button
          className="primary"
          onClick={async () => {
            try {
              await local!.createTask({ title, prompt, role });
              setTitle("");
              setPrompt("");
              await load();
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          <Plus size={16} />
          Save to queue
        </button>
        <button className="text-button" onClick={load}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {!items.length && (
        <p className="muted">
          No tasks yet. Nothing running behind the scenes.
        </p>
      )}
      {items.map((item) => (
        <article className="skill" key={item.id}>
          <div className="skill-head">
            <div>
              <small>
                {item.role} · {item.status}
              </small>
              <h3>{item.title}</h3>
              <p>{item.prompt}</p>
            </div>
            {["queued", "interrupted"].includes(item.status) ? (
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await local!.cancelTask(item.id);
                    await load();
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
          {["failed", "interrupted"].includes(item.status) && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await local!.retryTask(item.id);
                  await load();
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              Queue again
            </button>
          )}
          <details>
            <summary>Activity log</summary>
            {item.logs.map((log, i) => (
              <p key={i} className="muted">
                {new Date(log.at).toLocaleString()} · {log.message}
              </p>
            ))}
          </details>
          {!["queued", "running"].includes(item.status) && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await local!.removeTask(item.id);
                  await load();
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              <Trash2 size={14} />
              Remove record…
            </button>
          )}
        </article>
      ))}
    </>
  );
}
export function RemindersPanel({ report }: Props) {
  const [items, setItems] = useState<Reminder[]>([]),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [now, setNow] = useState(Date.now());
  async function load() {
    if (local)
      try {
        setItems(await local.listReminders());
      } catch (e) {
        report((e as Error).message);
      }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  if (!local) return <DesktopOnly />;
  return (
    <>
      <h2>Leave a nudge for later.</h2>
      <p className="muted">
        Local in-app reminders. Due items appear here when Sebby is open; this
        build does not send system notifications or run when closed.
      </p>
      <label className="field-label" htmlFor="reminder-title">
        Reminder
      </label>
      <input
        id="reminder-title"
        value={title}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="field-label" htmlFor="reminder-time">
        Your local date and time
      </label>
      <input
        id="reminder-time"
        type="datetime-local"
        value={due}
        onChange={(e) => setDue(e.target.value)}
      />
      <button
        className="primary spaced"
        onClick={async () => {
          try {
            await local!.createReminder({
              title,
              dueAt: new Date(due).getTime(),
            });
            setTitle("");
            setDue("");
            await load();
          } catch (e) {
            report((e as Error).message);
          }
        }}
      >
        <Clock size={16} />
        Save reminder
      </button>
      {items.map((item) => (
        <article className="skill" key={item.id}>
          <small>
            {item.status === "scheduled" && item.dueAt <= now
              ? "Due now"
              : item.status}{" "}
            · {new Date(item.dueAt).toLocaleString()}
          </small>
          <h3>{item.title}</h3>
          {item.status !== "dismissed" && (
            <div className="button-row">
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await local!.dismissReminder(item.id);
                    await load();
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                Dismiss
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await local!.snoozeReminder({
                      id: item.id,
                      dueAt: Date.now() + 10 * 60 * 1000,
                    });
                    await load();
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                Snooze 10 minutes
              </button>
            </div>
          )}
        </article>
      ))}
    </>
  );
}
export function ImportedSkills({
  report,
  useSkill,
}: {
  report: (s: string) => void;
  useSkill: (s: string) => void;
}) {
  const [items, setItems] = useState<Skill[]>([]),
    [id, setId] = useState("user-"),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [instructions, setInstructions] = useState("");
  async function load() {
    if (local)
      try {
        setItems((await local.listSkills()).filter((s) => s.origin === "user"));
      } catch (e) {
        report((e as Error).message);
      }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <h3 className="spaced">Your instruction library</h3>
      <p className="muted">
        Imported playbooks are untrusted instructions, not executable plugins or
        permission to use tools.
      </p>
      {!local ? (
        <DesktopOnly />
      ) : (
        <>
          <details className="import-form">
            <summary>Add a skill</summary>
            <label className="field-label">ID (user-…)</label>
            <input
              aria-label="Skill ID"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
            <label className="field-label">Name</label>
            <input
              aria-label="Skill name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="field-label">Description</label>
            <input
              aria-label="Skill description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className="field-label">Instructions</label>
            <textarea
              aria-label="Skill instructions"
              className="note"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={32000}
            />
            <button
              className="primary"
              onClick={async () => {
                try {
                  await local!.importSkill({
                    id,
                    name,
                    description,
                    instructions,
                  });
                  setId("user-");
                  setName("");
                  setDescription("");
                  setInstructions("");
                  await load();
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              Save instruction skill
            </button>
          </details>
          {items.map((item) => (
            <article className="skill" key={item.id}>
              <small>Imported · Untrusted instructions</small>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <details>
                <summary>Read instructions</summary>
                <pre>{item.instructions}</pre>
              </details>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => useSkill(item.instructions)}
                >
                  Use in draft
                </button>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await local!.removeSkill(item.id);
                      await load();
                    } catch (e) {
                      report((e as Error).message);
                    }
                  }}
                >
                  Remove…
                </button>
              </div>
            </article>
          ))}
        </>
      )}
    </>
  );
}
export function SavedDrafts({
  draft,
  useDraft,
  report,
}: {
  draft: string;
  useDraft: (s: string) => void;
  report: (s: string) => void;
}) {
  const [items, setItems] = useState<Conversation[]>([]),
    [saved, setSaved] = useState("");
  async function load() {
    if (local)
      try {
        setItems(await local.listConversations());
      } catch (e) {
        report((e as Error).message);
      }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <details className="saved-drafts">
      <summary>
        Saved drafts · all projects {items.length ? `(${items.length})` : ""}
      </summary>
      {!local ? (
        <p className="muted">
          Named draft history is available in the desktop app.
        </p>
      ) : (
        <>
          <button
            className="text-button"
            disabled={!draft.trim()}
            onClick={async () => {
              try {
                await local!.saveConversationDraft({
                  title: draft.trim().split("\n")[0].slice(0, 100),
                  text: draft,
                });
                setSaved("Draft saved locally. No message sent.");
                await load();
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            <FileText size={14} />
            Save this draft
          </button>
          <small role="status">{saved}</small>
          {items.map((item) => (
            <div className="draft-row" key={item.id}>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    const data = await local!.getConversation(item.id);
                    useDraft(data.draft || "");
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                {item.title}
              </button>
              <button
                className="text-button"
                aria-label={`Delete ${item.title}`}
                onClick={async () => {
                  try {
                    await local!.removeConversation(item.id);
                    await load();
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </>
      )}
    </details>
  );
}
export function VoicePreview() {
  const [message, setMessage] = useState("");
  return (
    <div className="callout">
      <h3>Local voice preview</h3>
      <p>
        Optional, device-local speech output only. No microphone access or cloud
        voice. Available voices depend on your operating system.
      </p>
      <div className="button-row">
        <button
          className="secondary"
          onClick={() => {
            if (!("speechSynthesis" in window)) {
              setMessage("Speech output is unavailable here.");
              return;
            }
            const voice = speechSynthesis
              .getVoices()
              .find((v) => v.localService && v.lang.startsWith("en"));
            if (!voice) {
              setMessage(
                "No device-local English voice is available. Nothing was sent to a remote service.",
              );
              return;
            }
            speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(
              "Hey, I’m Sebby. Ready when you are. What are we building?",
            );
            utterance.voice = voice;
            utterance.onerror = () =>
              setMessage("Local speech could not play.");
            utterance.onend = () => setMessage("Preview finished.");
            speechSynthesis.speak(utterance);
            setMessage("Playing device-local voice preview.");
          }}
        >
          <Volume2 size={16} />
          Play voice preview
        </button>
        <button
          className="text-button"
          onClick={() => {
            if ("speechSynthesis" in window) speechSynthesis.cancel();
            setMessage("Stopped.");
          }}
        >
          <Square size={14} />
          Stop
        </button>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
