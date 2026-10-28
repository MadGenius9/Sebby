import { useEffect, useId, useState } from "react";
import type { Task } from "./bridge";
type AgentStatus = {
  configured: boolean;
  provider?: string;
  model?: string;
  profileId?: string;
};
interface AgentApi {
  providerStatus(): Promise<AgentStatus>;
  startAgent(input: {
    taskId: string;
    contextOptions: {
      includeMemory: boolean;
      skillId?: string;
      filePaths: string[];
      allowReadTools: boolean;
      allowEdits: boolean;
    };
    limits: { maxCalls: number; maxTotalTokens: number };
  }): Promise<unknown>;
  cancelAgent(taskId: string): Promise<unknown>;
  reviewAgent(taskId: string): Promise<unknown>;
}
type Props = {
  task: Task;
  report: (message: string) => void;
  refresh: () => void | Promise<unknown>;
};
type Evidence = {
  tool: string;
  path?: string;
  status?: string;
  applied?: boolean;
  count?: number;
  sha256?: string;
  hash?: string;
};
type Result = {
  model: string;
  specialist: { responseId: string; text: string };
  coordinator: { responseId: string; text: string };
  evidence: Evidence[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  providerCalls: number;
  conservativeTokenReservation: number;
};
const string = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
function readResult(raw: Task["result"]): Result | null {
  if (!raw || raw.length > 256000) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value?.format !== "sebby-agent-result" ||
      value.version !== 1 ||
      !string(value.model, 200) ||
      !string(value.specialist?.text, 100000) ||
      !string(value.specialist?.responseId, 200) ||
      !string(value.coordinator?.text, 100000) ||
      !string(value.coordinator?.responseId, 200) ||
      !Array.isArray(value.evidence) ||
      value.evidence.length > 100 ||
      value.requiresUserAcceptance !== true
    )
      return null;
    const evidence: Evidence[] = value.evidence.map(
      (item: Record<string, unknown>) => {
        if (!item || !string(item.tool, 100)) throw Error();
        const safe: Evidence = { tool: item.tool };
        for (const key of ["path", "status", "sha256", "hash"] as const)
          if (string(item[key], 1024)) safe[key] = item[key];
        if (typeof item.applied === "boolean") safe.applied = item.applied;
        if (Number.isSafeInteger(item.count) && Number(item.count) >= 0)
          safe.count = Number(item.count);
        return safe;
      },
    );
    const usage =
      value.usage &&
      ["inputTokens", "outputTokens", "totalTokens"].every(
        (key) =>
          Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0,
      )
        ? value.usage
        : null;
    return {
      model: value.model,
      specialist: value.specialist,
      coordinator: value.coordinator,
      evidence,
      usage,
      providerCalls: Number.isSafeInteger(value.providerCalls)
        ? value.providerCalls
        : 0,
      conservativeTokenReservation: Number.isSafeInteger(
        value.conservativeTokenReservation,
      )
        ? value.conservativeTokenReservation
        : 0,
    };
  } catch {
    return null;
  }
}
export function AgentTaskControls({ task, report, refresh }: Props) {
  const prefix = useId();
  const api = window.sebby as unknown as AgentApi | undefined;
  const [status, setStatus] = useState<AgentStatus | null>(null),
    [pending, setPending] = useState(false),
    [memory, setMemory] = useState(false),
    [read, setRead] = useState(false),
    [edits, setEdits] = useState(false),
    [paths, setPaths] = useState(""),
    [skill, setSkill] = useState(""),
    [calls, setCalls] = useState(3),
    [tokens, setTokens] = useState(20000),
    [opened, setOpened] = useState(false);
  useEffect(() => {
    let live = true;
    if (api?.providerStatus)
      api
        .providerStatus()
        .then((value) => {
          if (live) setStatus(value);
        })
        .catch(() => {
          if (live) setStatus({ configured: false });
        });
    return () => {
      live = false;
    };
  }, [api, task.id, task.status]);
  useEffect(() => setOpened(false), [task.result]);
  if (task.kind !== "ai") return null;
  const result = readResult(task.result),
    ready = !!(status?.configured && status.model && api?.startAgent),
    active = ["running", "awaiting-approval"].includes(task.status);
  async function act(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await action();
      await refresh();
    } catch {
      report(
        "The agent action could not be completed. Review the selected profile, task state and desktop permissions, then try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function start() {
    if (!api || !ready) return;
    const filePaths = paths
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      filePaths.length > 10 ||
      new Set(filePaths).size !== filePaths.length ||
      filePaths.some(
        (path) =>
          path.length > 1024 ||
          path.includes("\\") ||
          path.includes(":") ||
          path.startsWith("/") ||
          path
            .split("/")
            .some((part) => !part || part === "." || part === ".."),
      )
    ) {
      report(
        "Choose up to 10 unique relative workspace file paths, one per line; no parent traversal or absolute paths.",
      );
      return;
    }
    if (
      !Number.isInteger(calls) ||
      calls < 2 ||
      calls > 6 ||
      !Number.isInteger(tokens) ||
      tokens < 1000 ||
      tokens > 200000
    ) {
      report(
        "Choose 2–6 provider calls and a token reservation between 1,000 and 200,000.",
      );
      return;
    }
    await act(() =>
      api.startAgent({
        taskId: task.id,
        contextOptions: {
          includeMemory: memory,
          filePaths,
          allowReadTools: read,
          allowEdits: edits,
          ...(skill.trim() ? { skillId: skill.trim() } : {}),
        },
        limits: { maxCalls: calls, maxTotalTokens: tokens },
      }),
    );
  }
  return (
    <section aria-label="AI agent controls" className="callout">
      <h4>Real specialist run</h4>
      <p className="muted">
        Uses the selected provider profile in Settings. A native approval
        reviews API charges and context before work starts. A separate model
        coordinator critiques the result; only you accept completion.
      </p>
      <p role="status">
        {status
          ? status.configured && status.model
            ? `Selected: ${status.provider || "provider"} · ${status.model}`
            : "Configure a provider key and model in Settings before starting."
          : "Checking selected provider profile…"}
      </p>
      {task.status === "queued" && (
        <>
          <fieldset disabled={pending}>
            <legend>Context and permissions · off unless selected</legend>
            <div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={memory}
                  onChange={(event) => setMemory(event.target.checked)}
                />
                Include this workspace’s saved memory
              </label>
              <label className="field-label" htmlFor={`${prefix}-files`}>
                Explicit workspace file paths (up to 10, one per line)
              </label>
              <textarea
                id={`${prefix}-files`}
                className="note"
                value={paths}
                onChange={(event) => setPaths(event.target.value)}
                placeholder="src/example.ts"
              />
              <label className="field-label" htmlFor={`${prefix}-skill`}>
                Optional skill ID
              </label>
              <input
                id={`${prefix}-skill`}
                value={skill}
                maxLength={120}
                onChange={(event) => setSkill(event.target.value)}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={read}
                  onChange={(event) => setRead(event.target.checked)}
                />
                Allow bounded workspace read tools
              </label>
              <p className="muted">
                Reading a file for the model requires approval before its
                contents leave this device.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={edits}
                  onChange={(event) => setEdits(event.target.checked)}
                />
                Allow file-edit proposals
              </label>
              {edits && (
                <p role="note">
                  Every edit still requires a full diff review and native
                  approval. Cancellation does not undo edits already approved
                  and applied.
                </p>
              )}
              <label className="field-label" htmlFor={`${prefix}-calls`}>
                Maximum provider calls, including coordinator (2–6)
              </label>
              <input
                id={`${prefix}-calls`}
                type="number"
                min={2}
                max={6}
                value={calls}
                onChange={(event) => setCalls(Number(event.target.value))}
              />
              <label className="field-label" htmlFor={`${prefix}-tokens`}>
                Conservative token reservation (1,000–200,000)
              </label>
              <input
                id={`${prefix}-tokens`}
                type="number"
                min={1000}
                max={200000}
                value={tokens}
                onChange={(event) => setTokens(Number(event.target.value))}
              />
              <p className="muted">
                This is a token guard, not a currency quote or a guarantee of
                provider billing.
              </p>
            </div>
          </fieldset>
          <button
            className="primary"
            disabled={!ready || pending}
            onClick={start}
          >
            {pending
              ? "Requesting approval…"
              : "Review context and start AI run"}
          </button>
        </>
      )}
      {active && (
        <>
          <p>
            No fabricated progress: follow the task log for actual provider and
            tool evidence.
          </p>
          <button
            className="secondary"
            disabled={pending || !api?.cancelAgent}
            onClick={() => act(() => api!.cancelAgent(task.id))}
          >
            Cancel AI run
          </button>
        </>
      )}
      {task.result && (
        <details onToggle={(event) => setOpened(event.currentTarget.open)}>
          <summary>Review specialist, coordinator and tool evidence</summary>
          {result ? (
            <>
              <h4>Specialist answer</h4>
              <pre>{result.specialist.text}</pre>
              <small>Response: {result.specialist.responseId}</small>
              <h4>Model coordinator review</h4>
              <pre>{result.coordinator.text}</pre>
              <small>
                Response: {result.coordinator.responseId} · Model:{" "}
                {result.model}
              </small>
              <h4>Recorded tool evidence</h4>
              {result.evidence.length ? (
                <ul>
                  {result.evidence.map((item, index) => (
                    <li key={index}>
                      <strong>{item.tool}</strong>
                      {item.path && <> · {item.path}</>}
                      {item.status && <> · {item.status}</>}
                      {typeof item.applied === "boolean" && (
                        <>
                          {" "}
                          ·{" "}
                          {item.applied
                            ? "Applied after approval"
                            : "Not applied"}
                        </>
                      )}
                      {item.count !== undefined && (
                        <> · {item.count} file entries</>
                      )}
                      {(item.sha256 || item.hash) && (
                        <div>
                          <small>SHA-256: {item.sha256 || item.hash}</small>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No tool executions recorded. Do not infer that files were
                  changed or tests ran.
                </p>
              )}
              <h4>Usage and limits</h4>
              <p>
                {result.providerCalls} provider calls.{" "}
                {result.usage
                  ? `${result.usage.inputTokens} input + ${result.usage.outputTokens} output = ${result.usage.totalTokens} provider-reported tokens.`
                  : "Complete provider-reported usage unavailable; no cost inferred."}
              </p>
              <p>
                Conservative reserved tokens:{" "}
                {result.conservativeTokenReservation}. Not a price.
              </p>
              <p>
                A model review is not proof of correctness, test execution or
                safety. Inspect the evidence and verify important behavior
                yourself.
              </p>
            </>
          ) : (
            <p role="alert">
              This result does not match the supported evidence format. It
              cannot be accepted from this control.
            </p>
          )}
        </details>
      )}
      {task.status === "awaiting-review" && (
        <button
          className="primary"
          disabled={pending || !result || !opened || !api?.reviewAgent}
          onClick={() => act(() => api!.reviewAgent(task.id))}
        >
          Review evidence and request acceptance
        </button>
      )}
    </section>
  );
}
