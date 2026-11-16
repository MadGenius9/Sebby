import { useCallback, useEffect, useState } from "react";
import type {
  ProjectBinding,
  ProposalSummary,
  ProposalReview,
} from "@shared/workspace/schema";
import { workspaceApi, type Project } from "./api";
type Agent = {
  id: string;
  name: string;
  label: string;
  model: string | null;
  provider: string | null;
  binding: ProjectBinding | null;
};
export function AgentsPanel({
  project,
  dirty,
  workspaceOnly,
  apply,
}: {
  project: Project;
  dirty: boolean;
  workspaceOnly: boolean;
  apply: (id: string, hash: string) => Promise<void>;
}) {
  const [agents, setAgents] = useState<Agent[]>([]),
    [proposals, setProposals] = useState<ProposalSummary[]>([]),
    [agentId, setAgentId] = useState(""),
    [allowRuns, setAllowRuns] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [review, setReview] = useState<ProposalReview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const refresh = useCallback(async () => {
    const [a, p] = await Promise.all([
      workspaceApi.projectAgents(project.id),
      workspaceApi.proposals(project.id),
    ]);
    setAgents(a.agents);
    setProposals(p.proposals);
    setVersion((v) => v + 1);
  }, [project.id]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh, project.revision]);
  useEffect(() => {
    let current = true;
    setReview(null);
    if (selected)
      workspaceApi
        .reviewProposal(selected)
        .then((r) => {
          if (current) setReview(r);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [selected, version]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agents-panel">
      <div className="panel-toolbar">
        <h2>Project agents</h2>
        <button
          className="btn btn--secondary"
          type="button"
          disabled={busy}
          onClick={() => void action(async () => {})}
        >
          Refresh proposals
        </button>
      </div>
      <p className="workspace-note">
        Assigning an agent lets its configured AI provider receive this
        project's saved files and scene when requested. Proposals wait for your
        review. Reassigning or unassigning revokes pending proposals and new
        project tool calls; already-started builds can be cancelled in Runs.
      </p>
      {workspaceOnly && (
        <p className="workspace-note">
          Local workspace mode does not start AI engines. Agents must already be
          configured in the full Sebby service.
        </p>
      )}
      {error && (
        <p role="alert" className="workspace-message is-error">
          {error}
        </p>
      )}
      <div className="agent-assignments">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(() =>
              workspaceApi.bindAgent(project.id, agentId, allowRuns),
            );
          }}
        >
          <label>
            Agent
            <select
              aria-label="Project agent"
              value={agentId}
              disabled={busy}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Choose a configured agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.provider || "provider not selected"}
                  {a.binding ? ` · ${a.binding.projectName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowRuns}
              disabled={busy}
              onChange={(e) => setAllowRuns(e.target.checked)}
            />
            Allow this agent to start builds/tests on the isolated worker
          </label>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy || !agentId}
          >
            Assign to this project
          </button>
        </form>
        {agents.length === 0 && (
          <p className="workspace-note">
            No agents are configured for this account. Configure an engine in
            the full service before assigning it.
          </p>
        )}
        {agents
          .filter((a) => a.binding?.projectId === project.id)
          .map((a) => (
            <div className="assigned-agent" key={a.id}>
              <div>
                <strong>{a.name}</strong>
                <span>
                  {a.provider || "Provider not selected"} ·{" "}
                  {a.model || "Engine default"} · Build/test{" "}
                  {a.binding?.allowRuns ? "enabled" : "disabled"}
                </span>
              </div>
              {!workspaceOnly && (
                <a
                  href={`/?bot=${encodeURIComponent(a.id)}`}
                  className="btn btn--secondary"
                >
                  Open agent chat
                </a>
              )}
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy}
                onClick={() =>
                  void action(() => workspaceApi.unbindAgent(project.id, a.id))
                }
              >
                Unassign
              </button>
            </div>
          ))}
      </div>
      <div className="proposal-layout">
        <aside className="proposal-list">
          <h2>Proposed changes</h2>
          {proposals.length === 0 ? (
            <p>
              No proposals yet. Ask an assigned agent to inspect this project
              and propose a change.
            </p>
          ) : (
            proposals.map((p) => (
              <button
                type="button"
                key={p.id}
                aria-current={selected === p.id ? "page" : undefined}
                onClick={() => setSelected(p.id)}
              >
                <strong>{p.summary}</strong>
                <span>
                  {p.botName} · r{p.baseRevision} ·{" "}
                  {p.stale ? "stale" : p.state}
                </span>
              </button>
            ))
          )}
        </aside>
        <div className="proposal-review">
          {review ? (
            <>
              <div className="proposal-heading">
                <h2>{review.proposal.summary}</h2>
                <p>
                  {review.proposal.botName} · saved revision{" "}
                  {review.proposal.baseRevision} · {review.proposal.state}
                  {review.proposal.stale ? " · stale" : ""}
                </p>
                <div className="proposal-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={
                      busy ||
                      dirty ||
                      review.proposal.state !== "pending" ||
                      review.proposal.stale
                    }
                    onClick={() =>
                      void action(() =>
                        apply(review.proposal.id, review.proposal.reviewHash),
                      )
                    }
                  >
                    Apply reviewed changes
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy || review.proposal.state !== "pending"}
                    onClick={() =>
                      void action(() =>
                        workspaceApi.rejectProposal(review.proposal.id),
                      )
                    }
                  >
                    Reject proposal
                  </button>
                </div>
                {dirty && (
                  <p>
                    Save or export your manual edits before applying a proposal.
                  </p>
                )}
                {review.proposal.stale && (
                  <p>
                    This proposal cannot be applied. Ask the agent for a new
                    proposal against the latest revision.
                  </p>
                )}
              </div>
              <pre
                className="diff-output"
                aria-label="Agent proposed source diff"
              >
                {review.diff || "No source file changes."}
              </pre>
              {review.sceneChanged && (
                <div className="scene-review">
                  <section>
                    <h3>Previous scene</h3>
                    <pre>{JSON.stringify(review.beforeScene, null, 2)}</pre>
                  </section>
                  <section>
                    <h3>Proposed scene</h3>
                    <pre>{JSON.stringify(review.afterScene, null, 2)}</pre>
                  </section>
                </div>
              )}
            </>
          ) : (
            <p className="panel-placeholder">
              Select a proposal to inspect its exact source diff and scene
              changes. Nothing is applied automatically.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
