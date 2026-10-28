import { useState, useEffect } from "react";
import { FileCode, Undo2, ShieldCheck } from "lucide-react";
import {
  bridge,
  development,
  type EditProposal,
  type CommandPlan,
  type CommandRun,
} from "./bridge";
export function DevelopmentPanel({ report }: { report: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(""),
    [content, setContent] = useState(""),
    [hash, setHash] = useState<string | null | undefined>(undefined),
    [proposal, setProposal] = useState<EditProposal | null>(null),
    [undo, setUndo] = useState(""),
    [notice, setNotice] = useState(""),
    [plan, setPlan] = useState<CommandPlan | null>(null),
    [runs, setRuns] = useState<CommandRun[]>([]);
  useEffect(() => {
    if (!development) return;
    const timer = setInterval(
      () =>
        development!
          .listCommandRuns()
          .then(setRuns)
          .catch(() => {}),
      1500,
    );
    return () => clearInterval(timer);
  }, []);
  if (!development)
    return (
      <p className="muted">
        Reviewable file changes and command controls are available in the
        desktop app.
      </p>
    );
  async function discard() {
    if (proposal) {
      try {
        await development!.discardEdit(proposal.id);
        setProposal(null);
      } catch (e) {
        report((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  }
  return (
    <fieldset className="editor-controls" disabled={busy}>
      <h3 className="spaced">Reviewable file changes</h3>
      <p className="muted">
        Edit supported text files or create a root-level source file. Preview
        first, then confirm in a native dialog. Undo is available during this
        session and refuses files changed afterward.
      </p>
      <label className="field-label" htmlFor="edit-path">
        Relative file path
      </label>
      <input
        id="edit-path"
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setHash(undefined);
          void discard();
        }}
      />
      <div className="button-row">
        <button
          className="text-button"
          onClick={async () => {
            setBusy(true);
            try {
              const file = await bridge.readFile(path);
              const bytes = new TextEncoder().encode(file.content);
              const digest = await crypto.subtle.digest("SHA-256", bytes);
              setHash(
                [...new Uint8Array(digest)]
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join(""),
              );
              setContent(file.content);
              await discard();
              setNotice("Loaded the current file.");
            } catch (e) {
              report((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Load existing file
        </button>
        <button
          className="text-button"
          onClick={() => {
            setHash(null);
            setContent("");
            void discard();
            setNotice("New-file mode: preview refuses any existing file.");
          }}
        >
          New root-level file
        </button>
      </div>
      <label className="field-label" htmlFor="edit-content">
        Proposed complete contents
      </label>
      <textarea
        id="edit-content"
        className="note code"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          void discard();
        }}
        maxLength={64000}
      />
      <button
        className="secondary"
        disabled={hash === undefined}
        onClick={async () => {
          setBusy(true);
          try {
            await discard();
            setProposal(
              await development!.previewEdit({
                path,
                content,
                expectedHash: hash,
              }),
            );
            setNotice("Preview only. Nothing has been written.");
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileCode size={16} />
        Preview change
      </button>
      {proposal && (
        <div className="callout">
          <h3>
            {proposal.kind}: {proposal.path}
          </h3>
          <p className="muted">
            Whole-file diff · {proposal.diff.removedLines} removed /{" "}
            {proposal.diff.addedLines} added lines
          </p>
          <pre className="change-diff">{proposal.diff.text}</pre>
          {proposal.diff.truncated && (
            <p>Diff truncated. Shorten the proposed change before approval.</p>
          )}
          <button
            className="primary"
            disabled={proposal.diff.truncated}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await development!.applyEdit(proposal.id);
                if (result.applied) {
                  setUndo(result.id!);
                  setHash(proposal.afterHash);
                  setProposal(null);
                  setNotice(
                    proposal.kind === "create"
                      ? "New file created. Session undo is available."
                      : "Change applied. Original content was backed up.",
                  );
                } else setNotice("Cancelled. No change applied.");
              } catch (e) {
                report((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ShieldCheck size={16} />
            Review and approve…
          </button>
        </div>
      )}
      {undo && (
        <button
          className="text-button spaced"
          onClick={async () => {
            setBusy(true);
            try {
              const result = await development!.undoEdit(undo);
              if (result.undone) {
                setUndo("");
                setHash(undefined);
                setNotice(
                  "Change undone. Reload the file before editing again.",
                );
              }
            } catch (e) {
              report((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Undo2 size={16} />
          Undo last applied change…
        </button>
      )}
      <p role="status" className="muted">
        {notice}
      </p>
      <h3 className="spaced">Command safety boundary</h3>
      <p className="muted">
        Only Git status can be configured here. Build/test execution is
        implemented in the service for a trusted runner, but disabled in this
        UI; Windows needs process-tree containment first. This is not a terminal
        sandbox.
      </p>
      <button
        className="secondary"
        onClick={async () => {
          setBusy(true);
          try {
            const result = await development!.configureGit();
            setNotice(
              result.configured
                ? "Trusted Git selected for this session."
                : "Git setup cancelled.",
            );
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Choose trusted Git…
      </button>
      <button
        className="text-button spaced"
        onClick={async () => {
          setBusy(true);
          try {
            if (plan) await development!.discardCommand(plan.id);
            setPlan(await development!.planCommand("git-status"));
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Prepare Git status
      </button>
      {plan && (
        <div className="callout">
          <h3>{plan.display}</h3>
          <p>{plan.warning}</p>
          <button
            className="primary"
            onClick={async () => {
              setBusy(true);
              try {
                await development!.startCommand(plan.id);
                setPlan(null);
              } catch (e) {
                report((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Request approval…
          </button>
        </div>
      )}
      {runs.map((run) => (
        <article className="skill" key={run.id}>
          <small>
            {run.command} · {run.status}
            {run.exitCode !== undefined ? ` · exit ${run.exitCode}` : ""}
          </small>
          {run.error && <p role="alert">{run.error}</p>}
          {run.output && <pre className="change-diff">{run.output}</pre>}
          {run.truncated && <p>Output truncated.</p>}
          {(run.status === "running" || run.status === "awaiting-approval") && (
            <button
              className="secondary"
              onClick={async () => {
                setBusy(true);
                try {
                  await development!.cancelCommand(run.id);
                } catch (e) {
                  report((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel command
            </button>
          )}
        </article>
      ))}
    </fieldset>
  );
}
