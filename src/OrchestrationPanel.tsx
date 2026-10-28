import { useRef, useState } from "react";
type Step = {
  role: string;
  title: string;
  prompt: string;
  limits: { maxCalls: number; maxOutputTokens: number; maxTotalTokens: number };
};
type Plan = {
  id: string;
  phase: string;
  digest: string;
  errorCode: string | null;
  definition: {
    goal: string;
    identity: {
      profileId: string;
      provider: string;
      model: string;
      workspaceRoot: string;
    };
    steps: Step[];
    budget: { maxCalls: number; maxTotalTokens: number };
    reservation: { maxCalls: number; maxTotalTokens: number };
  };
  children: {
    index: number;
    taskId: string;
    runId: string | null;
    resultDigest: string | null;
    accepted: boolean;
    member: { name: string; role: string } | null;
  }[];
  finalResult: null | {
    text: string;
    responseId: string;
    sha256: string;
    usage: unknown;
    contextDigest: string;
  };
};
type API = {
  orchestrationStatus(): Promise<{ busy: boolean; plans: Plan[] }>;
  listTasks(): Promise<
    { id: string; title: string; status: string; result?: string }[]
  >;
  createOrchestration(input: unknown): Promise<unknown>;
  startOrchestrationStep(input: { planId: string }): Promise<unknown>;
  acceptOrchestrationStep(input: {
    planId: string;
    taskId: string;
    resultDigest: string;
  }): Promise<unknown>;
  finalizeOrchestration(input: { planId: string }): Promise<unknown>;
  acceptOrchestrationFinal(input: {
    planId: string;
    finalResultDigest: string;
  }): Promise<unknown>;
  cancelOrchestration(input: { planId: string }): Promise<unknown>;
};
const newStep = (): Step => ({
  role: "planner",
  title: "",
  prompt: "",
  limits: { maxCalls: 3, maxOutputTokens: 2048, maxTotalTokens: 20000 },
});
export function OrchestrationPanel({
  report,
}: {
  report: (text: string) => void;
}) {
  const candidate = (window as unknown as { sebby?: Partial<API> }).sebby;
  const api = candidate?.orchestrationStatus ? (candidate as API) : undefined;
  const [goal, setGoal] = useState(""),
    [steps, setSteps] = useState<Step[]>([newStep()]),
    [memory, setMemory] = useState(false),
    [read, setRead] = useState(false),
    [edits, setEdits] = useState(false),
    [files, setFiles] = useState(""),
    [maxCalls, setMaxCalls] = useState(13),
    [maxTokens, setMaxTokens] = useState(100000),
    [finalOutput, setFinalOutput] = useState(2048),
    [finalTokens, setFinalTokens] = useState(20000),
    [plans, setPlans] = useState<Plan[]>([]),
    [tasks, setTasks] = useState<Awaited<ReturnType<API["listTasks"]>>>([]),
    [busy, setBusy] = useState(false),
    [serviceBusy, setServiceBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [opened, setOpened] = useState(""),
    [ack, setAck] = useState("");
  const lock = useRef(false);
  const filePaths = files
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const validFiles =
    filePaths.length <= 10 &&
    new Set(filePaths).size === filePaths.length &&
    filePaths.every(
      (p) =>
        p.length <= 240 &&
        !/[:\\\x00-\x1f]/.test(p) &&
        !p.startsWith("/") &&
        p.split("/").every((s) => s && s !== "." && s !== ".."),
    );
  const reservedCalls = steps.reduce((n, s) => n + s.limits.maxCalls, 1),
    reservedTokens = steps.reduce(
      (n, s) => n + s.limits.maxTotalTokens,
      finalTokens,
    );
  const valid =
    !!goal.trim() &&
    steps.every(
      (s) =>
        s.title.trim() &&
        s.prompt.trim() &&
        Number.isInteger(s.limits.maxCalls) &&
        s.limits.maxCalls >= 2 &&
        s.limits.maxCalls <= 6 &&
        Number.isInteger(s.limits.maxOutputTokens) &&
        s.limits.maxOutputTokens >= 128 &&
        s.limits.maxOutputTokens <= 3000 &&
        Number.isInteger(s.limits.maxTotalTokens) &&
        s.limits.maxTotalTokens >= 1000 &&
        s.limits.maxTotalTokens <= 200000,
    ) &&
    validFiles &&
    maxCalls >= reservedCalls &&
    maxCalls <= 25 &&
    maxTokens >= reservedTokens &&
    maxTokens <= 1000000 &&
    finalOutput >= 128 &&
    finalOutput <= 3000 &&
    finalTokens >= 1000 &&
    finalTokens <= 200000;
  async function refresh() {
    const [s, t] = await Promise.all([
      api!.orchestrationStatus(),
      api!.listTasks(),
    ]);
    if (!Array.isArray(s.plans) || !Array.isArray(t)) throw Error();
    setPlans(s.plans);
    setServiceBusy(s.busy);
    setTasks(t);
    setAck("");
    setOpened("");
  }
  async function run(fn: () => Promise<unknown>) {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    setAck("");
    try {
      await fn();
      await refresh();
    } catch {
      setNotice(
        "Action could not be confirmed. Refresh recorded state before retrying; no work is automatically replayed.",
      );
      report("Orchestration action could not be confirmed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const disabled = !api || busy || serviceBusy;
  const update = (i: number, patch: Partial<Step>) =>
    setSteps((v) => v.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  return (
    <section aria-label="Sequential specialist plans">
      <h3>Sequential specialist plans</h3>
      <p>
        One to four named specialists run sequentially, only when you explicitly
        start each step. Uses one locked selected provider profile and
        workspace. Each child has a model coordinator review; you accept its
        full evidence before the next step. One final tool-free critique is
        separately approved. Accepted does not mean proven correct or tested.
      </p>
      {!api && <p>Specialist orchestration requires the desktop app.</p>}
      <button disabled={!api || busy} onClick={() => void run(async () => {})}>
        Refresh plan status and evidence
      </button>
      <p role="status">{notice || "No action requested."}</p>
      <fieldset disabled={disabled}>
        <legend>Create a bounded plan</legend>
        <label>
          Plan goal
          <textarea
            value={goal}
            maxLength={4000}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={memory}
            onChange={(e) => setMemory(e.target.checked)}
          />
          Include project memory in each step
        </label>
        <label>
          <input
            type="checkbox"
            checked={read}
            onChange={(e) => setRead(e.target.checked)}
          />
          Permit bounded workspace read tools
        </label>
        <label>
          <input
            type="checkbox"
            checked={edits}
            onChange={(e) => setEdits(e.target.checked)}
          />
          Permit coder steps to propose edits
        </label>
        {edits && (
          <p>
            Edits require separate full-diff/native approval. Applied changes
            can remain after cancellation.
          </p>
        )}
        <label>
          Plan context file paths (one per line, at most 10)
          <textarea value={files} onChange={(e) => setFiles(e.target.value)} />
        </label>
        <p>
          These choices are the scope ceiling and selected context for every
          step; only coder steps may request edits. Nothing is included by
          default.
        </p>
        {steps.map((s, i) => (
          <fieldset key={i}>
            <legend>Step {i + 1}</legend>
            <label>
              Step {i + 1} role
              <select
                value={s.role}
                onChange={(e) => update(i, { role: e.target.value })}
              >
                {["planner", "researcher", "coder", "reviewer"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              Step {i + 1} title
              <input
                value={s.title}
                maxLength={160}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </label>
            <label>
              Step {i + 1} prompt
              <textarea
                value={s.prompt}
                maxLength={4000}
                onChange={(e) => update(i, { prompt: e.target.value })}
              />
            </label>
            {(["maxCalls", "maxTotalTokens", "maxOutputTokens"] as const).map(
              (k) => (
                <label key={k}>
                  Step {i + 1} {k}
                  <input
                    type="number"
                    value={s.limits[k]}
                    min={
                      k === "maxCalls" ? 2 : k === "maxTotalTokens" ? 1000 : 128
                    }
                    max={
                      k === "maxCalls"
                        ? 6
                        : k === "maxTotalTokens"
                          ? 200000
                          : 3000
                    }
                    onChange={(e) =>
                      update(i, {
                        limits: { ...s.limits, [k]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ),
            )}
            <button
              disabled={steps.length === 1}
              onClick={() => setSteps((v) => v.filter((_, n) => n !== i))}
            >
              Remove step {i + 1}
            </button>
          </fieldset>
        ))}
        <button
          disabled={steps.length >= 4}
          onClick={() => setSteps((v) => [...v, newStep()])}
        >
          Add sequential step
        </button>
        <label>
          Total plan call budget
          <input
            type="number"
            min={3}
            max={25}
            value={maxCalls}
            onChange={(e) => setMaxCalls(Number(e.target.value))}
          />
        </label>
        <label>
          Total plan token reservation
          <input
            type="number"
            min={2000}
            max={1000000}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
          />
        </label>
        <label>
          Final critique output token limit
          <input
            type="number"
            min={128}
            max={3000}
            value={finalOutput}
            onChange={(e) => setFinalOutput(Number(e.target.value))}
          />
        </label>
        <label>
          Final critique token reservation
          <input
            type="number"
            min={1000}
            max={200000}
            value={finalTokens}
            onChange={(e) => setFinalTokens(Number(e.target.value))}
          />
        </label>
        <p>
          Declared reservation: {reservedCalls} calls (including one final
          critique), {reservedTokens} tokens. Reservations are limits, not price
          estimates or refunds.
        </p>
        <button
          disabled={!valid}
          onClick={() =>
            void run(async () => {
              await api!.createOrchestration({
                goal,
                steps: steps.map((s) => ({
                  ...s,
                  contextOptions: {
                    includeMemory: memory,
                    allowReadTools: read,
                    allowEdits: edits && s.role === "coder",
                    filePaths,
                  },
                })),
                grantCeiling: {
                  includeMemory: memory,
                  allowReadTools: read,
                  allowEdits: edits,
                  skillIds: [],
                  filePaths,
                },
                budget: { maxCalls, maxTotalTokens: maxTokens },
                finalLimits: {
                  maxOutputTokens: finalOutput,
                  maxTotalTokens: finalTokens,
                },
              });
              setNotice(
                "Plan request reviewed. Check its recorded status; no step starts automatically.",
              );
            })
          }
        >
          Review plan with native confirmation
        </button>
      </fieldset>
      {plans.map((p) => (
        <article key={p.id}>
          <h4>{p.definition.goal}</h4>
          <p>
            Actual phase: {p.phase} · Plan {p.id}
          </p>
          <p>
            Locked profile: {p.definition.identity.profileId} ·{" "}
            {p.definition.identity.provider}/{p.definition.identity.model} ·
            Workspace: {p.definition.identity.workspaceRoot}
          </p>
          <p>
            Reserved: {p.definition.reservation.maxCalls} calls /{" "}
            {p.definition.reservation.maxTotalTokens} tokens.{" "}
            {p.errorCode ? `Recorded outcome: ${p.errorCode}` : ""}
          </p>
          <ol>
            {p.definition.steps.map((s, i) => (
              <li key={i}>
                {s.title} ({s.role}) — {s.prompt}
              </li>
            ))}
          </ol>
          {p.children.map((c) => {
            const t = tasks.find((t) => t.id === c.taskId);
            const key = `${p.id}:${c.taskId}:${c.resultDigest}`;
            const usable =
              typeof t?.result === "string" &&
              t.result.length > 0 &&
              t.result.length <= 256000;
            return (
              <section key={key} aria-label={`Step ${c.index + 1} evidence`}>
                <h5>
                  {c.member?.name || "Specialist identity not yet recorded"} ·{" "}
                  {p.definition.steps[c.index]?.title}
                </h5>
                <p>
                  Job: {c.member?.role || p.definition.steps[c.index]?.role} ·
                  Task {c.taskId} · Run {c.runId || "Not started"} · Task
                  status: {t?.status || "Unavailable"} ·{" "}
                  {c.accepted ? "User accepted evidence" : "Not accepted"}
                </p>
                <p>Result digest: {c.resultDigest || "Not recorded"}</p>
                {usable ? (
                  <details
                    open={opened === key}
                    onToggle={(e) => {
                      if (e.currentTarget.open) {
                        setOpened(key);
                        setAck("");
                      } else if (opened === key) {
                        setOpened("");
                        setAck("");
                      }
                    }}
                  >
                    <summary>
                      Full specialist result, coordinator review, tool evidence
                      and usage
                    </summary>
                    <pre>{t!.result}</pre>
                  </details>
                ) : (
                  <p>Complete result unavailable. Acceptance is disabled.</p>
                )}
                {p.phase === "awaiting-step-review" && !c.accepted && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={ack === key}
                        disabled={disabled || !usable || opened !== key}
                        onChange={(e) => setAck(e.target.checked ? key : "")}
                      />
                      I reviewed this complete specialist and coordinator
                      evidence.
                    </label>
                    <button
                      disabled={
                        disabled ||
                        !usable ||
                        opened !== key ||
                        ack !== key ||
                        !c.resultDigest
                      }
                      onClick={() =>
                        void run(() =>
                          api!.acceptOrchestrationStep({
                            planId: p.id,
                            taskId: c.taskId,
                            resultDigest: c.resultDigest!,
                          }),
                        )
                      }
                    >
                      Accept step evidence with native confirmation
                    </button>
                  </>
                )}
              </section>
            );
          })}
          {p.phase === "ready" && (
            <button
              disabled={disabled}
              onClick={() =>
                void run(() => api!.startOrchestrationStep({ planId: p.id }))
              }
            >
              Start next specialist with native approval
            </button>
          )}
          {p.phase === "ready-final" && (
            <button
              disabled={disabled}
              onClick={() =>
                void run(() => api!.finalizeOrchestration({ planId: p.id }))
              }
            >
              Request one final paid critique
            </button>
          )}
          {p.finalResult && (
            <section>
              <h5>Final aggregate critique</h5>
              <p>
                Response: {p.finalResult.responseId} · Evidence context digest:{" "}
                {p.finalResult.contextDigest}
              </p>
              <pre>{p.finalResult.text}</pre>
              <pre>Reported usage: {JSON.stringify(p.finalResult.usage)}</pre>
              {p.phase === "awaiting-final-review" && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={ack === p.finalResult.sha256}
                      disabled={disabled}
                      onChange={(e) =>
                        setAck(e.target.checked ? p.finalResult!.sha256 : "")
                      }
                    />
                    I reviewed the full final critique and accepted child
                    evidence; this is not proof of correctness.
                  </label>
                  <button
                    disabled={disabled || ack !== p.finalResult.sha256}
                    onClick={() =>
                      void run(() =>
                        api!.acceptOrchestrationFinal({
                          planId: p.id,
                          finalResultDigest: p.finalResult!.sha256,
                        }),
                      )
                    }
                  >
                    Accept final evidence with native confirmation
                  </button>
                </>
              )}
            </section>
          )}
          {!["completed", "cancelled", "failed", "interrupted"].includes(
            p.phase,
          ) && (
            <button
              disabled={!api}
              onClick={() => {
                void api!
                  .cancelOrchestration({ planId: p.id })
                  .then(() => {
                    setAck("");
                    setNotice(
                      "Cancellation requested. Refresh state; completed edits or billed requests may remain.",
                    );
                  })
                  .catch(() =>
                    report("Plan cancellation could not be confirmed."),
                  );
              }}
            >
              Cancel this plan
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
