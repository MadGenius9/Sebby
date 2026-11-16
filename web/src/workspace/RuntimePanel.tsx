import { useCallback, useEffect, useState } from "react";
import type { RunRecord, RunnerStatus } from "@shared/workspace/schema";
import { workspaceApi, type Project } from "./api";
const active = (r: RunRecord) =>
  ["preparing", "running", "stopping"].includes(r.state);
export function RuntimePanel({
  project,
  dirty,
}: {
  project: Project;
  dirty: boolean;
}) {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<RunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        workspaceApi.runtime(),
        workspaceApi.runs(project.id),
      ]);
      setStatus(s);
      setRuns(r.runs);
      setSelected(
        (prev) => r.runs.find((x) => x.id === prev?.id) || r.runs[0] || null,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project.id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const selectedId = selected?.id,
    live = !!selected && active(selected);
  useEffect(() => {
    if (!selectedId || !live) return;
    const events = new EventSource(`/api/workspace/runs/${selectedId}/events`);
    events.addEventListener("run", (e) => {
      try {
        const run: RunRecord = JSON.parse((e as MessageEvent).data).run;
        setSelected(run);
        setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
        if (!active(run)) events.close();
      } catch {
        events.close();
        setError(
          "Could not read live run status. Refresh to reload saved logs.",
        );
      }
    });
    events.onerror = () => {
      events.close();
      setError(
        "Live log connection interrupted. Refresh to reload the saved run status.",
      );
    };
    return () => events.close();
  }, [selectedId, live]);
  const run = async (command: "build" | "test") => {
    setBusy(true);
    setError("");
    try {
      const { run } = await workspaceApi.startRun(
        project.id,
        project.revision,
        command,
      );
      setSelected(run);
      setRuns((prev) => [run, ...prev]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="runtime-panel">
      <div className="panel-toolbar">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || dirty || !status?.available || runs.some(active)}
          onClick={() => void run("build")}
        >
          Run build
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || dirty || !status?.available || runs.some(active)}
          onClick={() => void run("test")}
        >
          Run tests
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void refresh()}
        >
          Refresh runtime
        </button>
        {selected && active(selected) && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || selected.state === "stopping"}
            onClick={async () => {
              setBusy(true);
              try {
                const { run } = await workspaceApi.cancelRun(selected.id);
                if (run) setSelected(run);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {selected.state === "stopping" ? "Stopping…" : "Cancel run"}
          </button>
        )}
      </div>
      <p className="workspace-note">
        {status?.reason || "Checking the isolated worker…"}{" "}
        {dirty ? "Save your changes before running commands." : ""}
      </p>
      {error && (
        <p role="alert" className="workspace-message is-error">
          {error}
        </p>
      )}
      <div className="run-layout">
        <aside className="run-history">
          <h2>Run history</h2>
          {runs.length === 0 ? (
            <p>No build or test runs yet.</p>
          ) : (
            runs.map((r) => (
              <button
                type="button"
                key={r.id}
                aria-current={selectedId === r.id ? "page" : undefined}
                onClick={() => setSelected(r)}
              >
                <strong>
                  {r.command} · r{r.revision}
                </strong>
                <span>{r.state.replaceAll("_", " ")}</span>
              </button>
            ))
          )}
        </aside>
        <div className="run-details">
          {selected ? (
            <>
              <div className="run-summary">
                <strong>
                  {selected.command} · {selected.state.replaceAll("_", " ")}
                </strong>
                <span>
                  Revision {selected.revision}
                  {selected.exitCode !== null
                    ? ` · exit ${selected.exitCode}`
                    : ""}
                </span>
                {selected.snapshotCommit && (
                  <code>Snapshot {selected.snapshotCommit.slice(0, 12)}</code>
                )}
                {selected.image && (
                  <code title={selected.image}>Image {selected.image}</code>
                )}
              </div>
              <pre
                className="run-log"
                aria-label="Run output"
                aria-live="polite"
              >
                {selected.log || "No output recorded yet."}
              </pre>
              {selected.state === "cleanup_failed" && (
                <p role="alert" className="workspace-message is-error">
                  Container cleanup could not be verified. The worker blocks new
                  runs until an operator resolves this.
                </p>
              )}
            </>
          ) : (
            <p className="panel-placeholder">
              Builds and tests use a saved project snapshot. Output appears here
              when a configured worker executes a run.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
