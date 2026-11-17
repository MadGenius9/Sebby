import { CompanionPanel } from "./CompanionPanel";
import { DrivePanel } from "./DrivePanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { SourceImportPanel } from "./SourceImportPanel";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Box,
  Code2,
  FolderOpen,
  MessageSquare,
  Save,
  Undo2,
  Redo2,
  Download,
  Settings2,
  Play,
  Terminal,
  GitCompare,
  Bot,
} from "lucide-react";
import { api } from "../lib/api";
import { PreviewPanel } from "./PreviewPanel";
import { RuntimePanel } from "./RuntimePanel";
import { ChangesPanel } from "./ChangesPanel";
import { AgentsPanel } from "./AgentsPanel";
import { CodingPanel } from "./CodingPanel";
import {
  download,
  workspaceApi,
  type Project,
  type ProjectSummary,
} from "./api";
import "./workspace.css";
const StudioPanel = lazy(() =>
  import("./StudioPanel").then((m) => ({ default: m.StudioPanel })),
);

type Auth = {
  user: { email: string } | null;
  devLogin: boolean;
  workspaceOnly?: boolean;
};
const fingerprint = (p: Project) =>
  JSON.stringify({ name: p.name, files: p.files, scene: p.scene });
function Login({ auth, refresh }: { auth: Auth; refresh: () => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="workspace-login">
      <img src="/orbit.png" alt="Sebby Orbit" />
      <h1>Sebby</h1>
      <p>Your workspace for coding and 3D creation.</p>
      {auth.workspaceOnly ? (
        <p>
          Local development workspace. Your email selects a local profile; it
          does not connect a Google account.
        </p>
      ) : (
        <a className="btn btn--primary" href="/api/auth/google/start">
          Sign in with Google
        </a>
      )}
      {auth.devLogin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.devLogin(email);
              refresh();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <label htmlFor="workspace-email">Email</label>
          <input
            id="workspace-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy} className="btn btn--primary">
            {busy ? "Opening…" : "Open workspace"}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function WorkspaceApp() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<
    | "code"
    | "studio"
    | "preview"
    | "runs"
    | "changes"
    | "knowledge"
    | "agents"
    | "connections"
  >("code");
  const [newName, setNewName] = useState("");
  const [mobileProjectsCollapsed, setMobileProjectsCollapsed] = useState(false);
  const [template, setTemplate] = useState<"blank" | "web">("web");
  const importInput = useRef<HTMLInputElement>(null);
  const [sourceImport, setSourceImport] = useState<"zip" | "github" | null>(
    null,
  );
  const [past, setPast] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const dirty = !!project && fingerprint(project) !== saved;
  const refreshAuth = useCallback(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error("Could not check sign-in");
        return r.json();
      })
      .then(setAuth)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(refreshAuth, [refreshAuth]);
  useEffect(() => {
    if (auth?.user)
      workspaceApi
        .list()
        .then((r) => setProjects(r.projects))
        .catch((e) => setError(e.message));
  }, [auth]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const adopt = (p: Project) => {
    setSourceImport(null);
    setMobileProjectsCollapsed(true);
    setProject(p);
    setSaved(fingerprint(p));
    setPast([]);
    setFuture([]);
    setError("");
    setNotice("");
    setProjects((prev) => [
      { id: p.id, name: p.name, revision: p.revision, updatedAt: p.updatedAt },
      ...prev.filter((x) => x.id !== p.id),
    ]);
  };
  const canLeave = () =>
    !dirty ||
    window.confirm(
      "Discard unsaved changes? You can cancel and save or export your work first.",
    );
  const open = async (id: string) => {
    if (busy || !canLeave()) return;
    setBusy(true);
    try {
      adopt((await workspaceApi.open(id)).project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !canLeave()) return;
    setBusy(true);
    try {
      adopt((await workspaceApi.create(newName, template)).project);
      setNewName("");
      setTab("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file || busy || !canLeave()) return;
    setBusy(true);
    try {
      if (file.size > 1000000)
        throw new Error("Project export must be under 1 MB");
      const doc = JSON.parse(await file.text());
      adopt((await workspaceApi.importProject(doc)).project);
      setTab("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  };
  const applyReviewed = async (id: string, hash: string) => {
    if (busy || dirty)
      throw new Error("Save your manual edits before applying a proposal.");
    setBusy(true);
    try {
      adopt((await workspaceApi.applyProposal(id, hash)).project);
      setNotice("Reviewed proposal applied and saved.");
    } finally {
      setBusy(false);
    }
  };
  const update = (next: Project) => {
    if (busy) return;
    setPast((p) => [...p.slice(-49), projectRef.current!]);
    setFuture([]);
    setProject(next);
    setNotice("");
  };
  const save = useCallback(async () => {
    if (!project || busy || !dirty) return;
    setBusy(true);
    setError("");
    try {
      const p = (await workspaceApi.save(project)).project;
      setProject(p);
      setSaved(fingerprint(p));
      setNotice("Project saved");
      setProjects((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? {
                id: p.id,
                name: p.name,
                revision: p.revision,
                updatedAt: p.updatedAt,
              }
            : x,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [project, busy, dirty]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [save]);
  if (!auth)
    return (
      <main className="workspace-login">
        <h1>Sebby</h1>
        <p>{error || "Opening workspace…"}</p>
        {error && (
          <button className="btn btn--secondary" onClick={refreshAuth}>
            Try again
          </button>
        )}
      </main>
    );
  if (!auth.user) return <Login auth={auth} refresh={refreshAuth} />;
  return (
    <div className="workspace-shell">
      <aside
        className="workspace-sidebar"
        data-mobile-collapsed={mobileProjectsCollapsed}
      >
        <div className="workspace-brand-row">
          <a
            className="workspace-brand"
            href="/workspace"
            onClick={(e) => {
              if (!canLeave()) e.preventDefault();
            }}
          >
            <img src="/orbit.png" alt="" />
            <span>
              Sebby<small>Coding & 3D Studio</small>
            </span>
          </a>
          <button
            type="button"
            className="btn btn--secondary mobile-project-toggle"
            aria-expanded={!mobileProjectsCollapsed}
            aria-controls="workspace-project-controls"
            onClick={() => setMobileProjectsCollapsed((value) => !value)}
          >
            Projects
          </button>
        </div>
        <div className="workspace-projects" id="workspace-project-controls">
          <h2>
            <FolderOpen size={15} /> Projects
          </h2>
          <nav aria-label="Projects">
            {projects.map((p) => (
              <button
                type="button"
                disabled={busy}
                key={p.id}
                aria-current={p.id === project?.id ? "page" : undefined}
                className={p.id === project?.id ? "is-active" : ""}
                onClick={() => void open(p.id)}
              >
                <FolderOpen size={16} />
                <span>{p.name}</span>
              </button>
            ))}
          </nav>
          <form onSubmit={create}>
            <label htmlFor="project-name">New project</label>
            <input
              id="project-name"
              placeholder="Project name"
              maxLength={80}
              required
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
            />
            <label htmlFor="project-template">Starting point</label>
            <select
              id="project-template"
              value={template}
              disabled={busy}
              onChange={(e) => setTemplate(e.target.value as "blank" | "web")}
            >
              <option value="web">Web starter</option>
              <option value="blank">Blank project</option>
            </select>
            <button
              className="btn btn--secondary"
              type="submit"
              disabled={busy || !newName.trim()}
            >
              Create project
            </button>
          </form>
          <button
            type="button"
            className="btn btn--secondary import-project"
            disabled={busy}
            onClick={() => importInput.current?.click()}
          >
            Import project JSON
          </button>
          <button
            type="button"
            className="btn btn--secondary import-project"
            disabled={busy}
            onClick={() => {
              setSourceImport("zip");
              setMobileProjectsCollapsed(true);
            }}
          >
            Import source ZIP
          </button>
          <button
            type="button"
            className="btn btn--secondary import-project"
            disabled={busy}
            onClick={() => {
              setSourceImport("github");
              setMobileProjectsCollapsed(true);
            }}
          >
            Import GitHub repository
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            aria-label="Import project JSON file"
            hidden
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
        <div className="workspace-sidebar-footer">
          {!auth.workspaceOnly && (
            <a
              href="/"
              onClick={(e) => {
                if (!canLeave()) e.preventDefault();
              }}
            >
              <MessageSquare size={16} /> Agent chat
            </a>
          )}
          <button type="button" onClick={() => setTab("connections")}>
            <Settings2 size={16} /> Connections
          </button>
          <small>{auth.user.email}</small>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!canLeave()) return;
              try {
                await api.logout();
                location.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="workspace-title">
              {project?.name ?? "Your workspace"}
            </span>
            <span className="workspace-status">
              {project
                ? dirty
                  ? "Unsaved changes"
                  : `Saved · revision ${project.revision}`
                : "Create or open a project"}
            </span>
          </div>
          {project && (
            <div className="workspace-actions">
              <button
                className="btn btn--secondary"
                type="button"
                aria-label="Undo"
                title="Undo"
                disabled={busy || !past.length}
                onClick={() => {
                  const prev = past[past.length - 1];
                  setFuture((f) => [project, ...f]);
                  setPast((p) => p.slice(0, -1));
                  setProject({ ...prev, revision: project.revision });
                  setNotice("");
                }}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="btn btn--secondary"
                type="button"
                aria-label="Redo"
                title="Redo"
                disabled={busy || !future.length}
                onClick={() => {
                  setPast((p) => [...p, project]);
                  setProject({ ...future[0], revision: project.revision });
                  setFuture((f) => f.slice(1));
                  setNotice("");
                }}
              >
                <Redo2 size={16} />
              </button>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() =>
                  download(
                    "sebby-project.json",
                    JSON.stringify(project, null, 2),
                    "application/json",
                  )
                }
              >
                <Download size={16} />
                <span>Export project</span>
              </button>
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                <Save size={16} />
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </header>
        {error && (
          <div className="workspace-message is-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="workspace-message" role="status">
            {notice}
          </div>
        )}
        <nav className="workspace-tabs" aria-label="Workspace tools">
          <button
            type="button"
            aria-current={tab === "code" ? "page" : undefined}
            onClick={() => setTab("code")}
          >
            <Code2 size={17} /> Coding
          </button>
          <button
            type="button"
            aria-current={tab === "studio" ? "page" : undefined}
            onClick={() => setTab("studio")}
          >
            <Box size={17} /> 3D Studio
          </button>
          <button
            type="button"
            aria-current={tab === "preview" ? "page" : undefined}
            onClick={() => setTab("preview")}
          >
            <Play size={17} /> Preview
          </button>
          <button
            type="button"
            aria-current={tab === "runs" ? "page" : undefined}
            onClick={() => setTab("runs")}
          >
            <Terminal size={17} /> Runs
          </button>
          <button
            type="button"
            aria-current={tab === "changes" ? "page" : undefined}
            onClick={() => setTab("changes")}
          >
            <GitCompare size={17} /> Changes
          </button>
          <button
            type="button"
            aria-current={tab === "agents" ? "page" : undefined}
            onClick={() => setTab("agents")}
          >
            <Bot size={17} /> Agents
          </button>
          <button
            type="button"
            aria-current={tab === "knowledge" ? "page" : undefined}
            onClick={() => setTab("knowledge")}
          >
            Project brain
          </button>
        </nav>
        {sourceImport ? (
          <SourceImportPanel
            key={sourceImport}
            initialMode={sourceImport}
            close={() => setSourceImport(null)}
            create={async (document) => {
              if (busy)
                throw new Error("Wait for the current operation to finish");
              if (!canLeave()) return;
              setBusy(true);
              try {
                adopt((await workspaceApi.importProject(document)).project);
                setTab("code");
                setNotice(
                  "Source imported as a new project. Review it before running any scripts.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : tab === "connections" ? (
          <section className="connections-panel">
            <Settings2 size={32} />
            <h1>Connected tools</h1>
            <p>
              Connect tools explicitly. Opening this workspace does not
              authorize account or computer access.
            </p>
            <dl>
              <dt>GitHub</dt>
              <dd>
                Public repository snapshot import available; private access and
                pull requests planned
              </dd>

              <dt>AI execution</dt>
              <dd>
                {auth.workspaceOnly
                  ? "Not connected in workspace mode"
                  : "Assign a configured agent in the project Agents panel; live engines require full service mode"}
              </dd>
            </dl>
            <CompanionPanel
              key={"companion-" + (project?.id || "no-project")}
              project={project}
              dirty={dirty}
              update={update}
            />
            <DrivePanel
              key={project?.id || "no-project"}
              project={project}
              dirty={dirty}
              update={update}
            />
          </section>
        ) : project ? (
          <fieldset className="workspace-content" disabled={busy}>
            {tab === "knowledge" ? (
              <KnowledgePanel
                key={project.id}
                project={project}
                dirty={dirty}
                update={update}
              />
            ) : tab === "agents" ? (
              <AgentsPanel
                key={project.id}
                project={project}
                dirty={dirty}
                workspaceOnly={!!auth.workspaceOnly}
                apply={applyReviewed}
              />
            ) : tab === "preview" ? (
              <PreviewPanel key={project.id} project={project} dirty={dirty} />
            ) : tab === "runs" ? (
              <RuntimePanel key={project.id} project={project} dirty={dirty} />
            ) : tab === "changes" ? (
              <ChangesPanel key={project.id} project={project} dirty={dirty} />
            ) : tab === "code" ? (
              <CodingPanel key={project.id} project={project} update={update} />
            ) : (
              <Suspense fallback={<p>Loading 3D Studio…</p>}>
                <StudioPanel
                  key={project.id}
                  project={project}
                  update={update}
                />
              </Suspense>
            )}
          </fieldset>
        ) : (
          <section className="workspace-empty">
            <img src="/orbit.png" alt="Sebby Orbit" />
            <h1>What are we building?</h1>
            <p>
              Create a project to start writing code or shaping a 3D scene. Your
              files and objects stay together.
            </p>
            <p className="workspace-note">
              Create a starter or import source. Assign agents and review their
              proposed edits; isolated builds require a configured worker.
            </p>
          </section>
        )}
        <footer className="workspace-bottom">
          <span>
            {project
              ? `${project.files.length} files · ${project.scene.objects.length} objects`
              : "Sebby foundation"}
          </span>
          <span>
            {auth.workspaceOnly ? "Local development" : "Server workspace"} ·
            Save explicitly or use Ctrl/⌘ S
          </span>
        </footer>
      </main>
    </div>
  );
}
