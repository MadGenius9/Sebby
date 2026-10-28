import { NoticesPanel } from "./NoticesPanel";
import { ChatPanel } from "./ChatPanel";
import { AppearancePanel } from "./Appearance";
import { ProviderSettings } from "./ProviderSettings";
import { ChangeReviewDialog } from "./ChangeReviewDialog";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  Folder,
  Database,
  Sparkles,
  Link,
  Settings,
  ShieldCheck,
  ChevronRight,
  Check,
  Copy,
  ListTodo,
  Clock,
  Users,
} from "lucide-react";
import { bridge, desktop, isBusy, type State } from "./bridge";
import { skills } from "./skills";
import { Workspace, Memory, Connections, PersonalityPanel } from "./Panels";
import { TeamPanel } from "./TeamPanel";
import { TasksPanel, RemindersPanel, ImportedSkills } from "./LocalPanels";
const sections = [
  ["Chat", MessageSquare],
  ["Workspace", Folder],
  ["Memory", Database],
  ["Skills", Sparkles],
  ["Tasks", ListTodo],
  ["Team", Users],
  ["Reminders", Clock],
  ["Connections", Link],
  ["Personality", Settings],
  ["Settings", Settings],
] as const;
export function App() {
  const [page, setPage] = useState("Chat"),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem("sebby.draft") || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    bridge
      .getState()
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("sebby.draft", draft);
    } catch {
      setError("Draft storage is unavailable. Copy your draft before closing.");
    }
  }, [draft]);
  async function choose() {
    if (isBusy()) {
      setError("Finish the current local operation before changing workspace.");
      return;
    }
    try {
      const next = await bridge.chooseWorkspace();
      if (next) setState(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function useSkill(prompt: string) {
    setDraft(prompt);
    setPage("Chat");
    setNotice("Playbook added to your local draft. No AI request was sent.");
  }
  return (
    <div className="app">
      <ChangeReviewDialog />
      <aside className="sidebar">
        <div className="brand">
          <img src="./orbit.png" alt="" />
          Sebby<span>•</span>
        </div>
        <nav aria-label="Main navigation">
          {sections.map(([name, Icon]) => (
            <button
              key={name}
              className={page === name ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPage(name);
                setError("");
                setNotice("");
              }}
            >
              <Icon size={20} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <Database size={15} />
            Local-first foundation
          </div>
          <div>
            <i />
            Configure AI in Settings
          </div>
          {!desktop && <small>Browser preview · local storage only</small>}
        </div>
      </aside>
      <main>
        <header>
          <h1>
            {page === "Chat" ? (
              <>
                Your workspace, <em>with company.</em>
              </>
            ) : (
              page
            )}
          </h1>
          <button className="secondary" onClick={choose}>
            <Folder size={17} />
            {state?.workspace?.name || "Choose workspace"}
          </button>
        </header>
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={error ? "banner error" : "banner"}
          >
            {error || notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              ×
            </button>
          </div>
        )}
        {!state ? (
          <div className="loading">Loading your local settings…</div>
        ) : page === "Chat" ? (
          <ChatPanel
            draft={draft}
            setDraft={setDraft}
            useSkill={useSkill}
            report={setError}
          />
        ) : (
          <div className="page-content">
            {page === "Settings" ? (
              <>
                <ProviderSettings report={setError} />
                <AppearancePanel report={setError} />
                <NoticesPanel report={setError} />
              </>
            ) : page === "Team" ? (
              <TeamPanel report={setError} />
            ) : page === "Tasks" ? (
              <TasksPanel report={setError} />
            ) : page === "Reminders" ? (
              <RemindersPanel report={setError} />
            ) : page === "Memory" ? (
              <Memory state={state} update={setState} report={setError} />
            ) : page === "Workspace" ? (
              <Workspace state={state} choose={choose} report={setError} />
            ) : page === "Connections" ? (
              <Connections report={setError} />
            ) : page === "Personality" ? (
              <PersonalityPanel
                state={state}
                update={setState}
                report={setError}
              />
            ) : (
              <>
                <h2>Small playbooks. Better starting points.</h2>
                <p className="muted">
                  Bundled instructions you can read, copy, or add to a draft.
                  These do not execute tools or call AI.
                </p>
                {skills.map((skill) => (
                  <article className="skill" key={skill.id}>
                    <div className="skill-head">
                      <div>
                        <small>{skill.category}</small>
                        <h3>{skill.name}</h3>
                        <p>{skill.description}</p>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => useSkill(skill.prompt)}
                      >
                        Use in draft <ChevronRight size={16} />
                      </button>
                    </div>
                    <details>
                      <summary>Read playbook</summary>
                      <pre>{skill.prompt}</pre>
                    </details>
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(skill.prompt);
                          setNotice("Playbook copied.");
                        } catch {
                          setError(
                            "Clipboard unavailable. Select and copy the playbook text instead.",
                          );
                        }
                      }}
                    >
                      <Copy size={14} />
                      Copy instructions
                    </button>
                  </article>
                ))}
                <ImportedSkills report={setError} useSkill={useSkill} />
              </>
            )}
          </div>
        )}
      </main>
      <aside className="inspector">
        <h2>At a glance</h2>
        {[
          [Folder, "Workspace", state?.workspace?.name || "No folder selected"],
          [
            Database,
            "Memory",
            state?.memory ? "Saved on this device" : "Ready when you are",
          ],
          [Sparkles, "Skills", "3 bundled playbooks"],
        ].map(([Icon, title, detail]) => {
          const I = Icon as typeof Folder;
          return (
            <button
              className="glance"
              key={String(title)}
              onClick={() => setPage(String(title))}
            >
              <I size={23} />
              <span>
                <strong>{String(title)}</strong>
                <small>{String(detail)}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          );
        })}
        <div className="control">
          <ShieldCheck size={27} />
          <div>
            <h3>You stay in control</h3>
            <p>
              File changes and Git status need your confirmation. No automatic
              execution.
            </p>
          </div>
        </div>
        <div className="version">
          <Check size={13} />
          Sebby 0.6 · Personal workbench
        </div>
      </aside>
    </div>
  );
}
