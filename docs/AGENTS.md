# Provider-backed named specialist runtime

`AgentRuntime` is an actual bounded orchestration implementation, not a simulated worker. It performs no work until a queued AI task is explicitly started, a model is selected, and native outbound-data approval succeeds. A configured provider credential is required by the provider adapter. The runtime checks credential availability before native outbound approval; missing configuration leaves the task queued. Model identifiers are validated before prompting. The implementation tests use a mocked provider and local temporary files; they do **not** prove live API connectivity, model quality, or Windows behavior.

## Work and review flow

1. Validate a queued task of kind `ai` bound to the currently selected workspace.
2. Validate an active named specialist already assigned to that exact task, with matching role. If omitted, reuse its assigned specialist or have Sebby assign a distinct authored name and job locally; actual task assignment happens only after native approval. A denied approval leaves the unused local identity, not a running task or provider request.
3. Build selected memory/skill/file context using trusted local services, not renderer-supplied file contents or paths to arbitrary stores.
4. Show a native approval with exact outbound context, model, workspace, named identity, tool scopes, request/output/cumulative limits, potential API charges, and the extra coordinator request.
5. Make a real specialist provider request; process only completed responses and allowed tool calls.
6. Make a **separate actual provider request** for Sebby's coordinator to critique the specialist result against the user task and observed tool evidence. Coordinator has no tools and cannot automatically approve anything.
7. Persist the specialist response, coordinator critique, response IDs, evidence and usage as `awaiting-review`.
8. Show separate native user acceptance of that evidence. Only acceptance changes the task to completed. Declining keeps it awaiting review.

The coordinator is another model response, not a proof of correctness. A user accepting known limitations does not make unperformed tests pass. An unsuccessful/incomplete/budget-exhausted run records failed or cancelled, never completion. Already approved edits may remain after any later failure/cancellation; inspect those changes before retrying. Running tasks interrupted by restart are not replayed automatically.

## Contract

```js
const runtime = new AgentRuntime({
  tasks, team, workspace, provider, store, skills, development,
  approve: async details => nativeContextOrFileApproval(details)
});
const run = await runtime.start({
  taskId, memberId, model: explicitlyChosenModel,
  contextOptions: {
    includeMemory: false,
    skillId: selectedSkillId, // omit if none
    filePaths: ['app.js'],
    allowReadTools: false,
    allowEdits: false
  },
  limits: {maxCalls: 5, maxOutputTokens: 1500, maxTotalTokens: 100000}
});
if (run.started) await runtime.wait(run.runId);
await runtime.review(taskId, {approveReview: nativeEvidenceAcceptance});
```

`store` supplies workspace memory, `skills` supplies validated instruction documents, and `development` is required only for optional coder edits. `approve` receives `agent-start` or `agent-send-file` requests; native confirmation must show the complete relevant content and must not trust renderer “approved” flags. `review` receives the parsed evidence object and SHA-256 of the stored result.

Other methods: `cancel(taskId)`, `shutdown()`, getters `isActive`/`activeCount`. Only one execution or result review runs at a time. Shutdown permanently closes the runtime before awaiting drainage. A delayed credential check, team/context preparation, native consent, or result acceptance cannot start requests or complete a task after shutdown. Pending dialog/provider promises may outlive the host’s bounded drain window, but closed/abort checks prevent later continuation. A shut-down runtime cannot be reused; create a new runtime only as part of a fresh application lifecycle. Provider and traversal cancellation uses AbortSignal. `wait` retains the latest twenty run promises per process; durable TaskStore is authoritative across restart.

## Capability boundaries

Tools are absent by default. If explicitly approved:

- `list_files`: bounded supported file metadata in the approved root. Paths themselves are outbound data, disclosed in initial scope.
- `read_file`: validated workspace path only, at most 16 KB text. Every tool-requested file requires an additional native approval showing exact content/hash **before that content is sent to the model**. Denial returns no content.
- `propose_edit`: coder-only, with development service configured and initial edit scope approved. Proposes a complete bounded replacement with observed hash or null for creation. DevelopmentTools creates a preview and requires its own native diff approval for every apply. No truncated diff can be applied. Cancellations during pending native edit approval prevent commit.

No shell, publish, account connection, install, browser automation, external URL fetch, or arbitrary network tool exists here. Tool output, user files, imported skills, memory, and specialist output are labeled untrusted. Unknown tools, traversal, malformed arguments, stale hashes, and native denial cannot elevate authority. Role names and specialties grant no extra capability.

The approved project may contain secrets under innocent filenames. Name filters are **not** secret detection. Review exact selected context and file-send consent carefully. Credentials are never read by this runtime, persisted in task results, or exposed to renderer/logs.

## Bounds and usage

- Selected initial files: at most 10; each at most 16 KB.
- Initial/current transcript context: at most 64 KiB.
- Tools: at most 8 calls per run.
- Provider calls: configurable 2–6 total, including exactly one coordinator request after a specialist final response; default 5.
- Output limit per call: configurable 128–3000 tokens, default 1500.
- Cumulative token-reservation guard: configurable 1000–200000, default 100000.

Before each request, a conservative byte-based reservation counts transcript/instructions/tool-schema bytes, requested output tokens, and protocol allowance. If the reservation would exceed the cumulative guard, no next request is sent. Reported provider usage is retained separately; missing usage is `null`, not invented. Sanitized known usage/coverage is appended to durable logs on each provider response, including incomplete/cancelled responses, without persisting raw response text or reasoning. Reservations are deliberately conservative estimates, **not exact billing or a guaranteed currency spending cap**. No model pricing is assumed and no retry is automatic.

Incomplete/error/cancelled provider outputs never run tool calls. Provider continuation items, including encrypted reasoning needed by compatible models, remain in memory only for the next request. They are never put in task logs/results, coordinator evidence, or the UI. Request-size limits may stop a long continuation rather than silently discard it.

## Result format and UI

Task `result` contains JSON text:

```text
format: sebby-agent-result
version: 1
runId, model, member
specialist: {responseId, text}
coordinator: {responseId, text}
evidence: bounded actual tool records
usage: provider-reported aggregate | null
providerCalls, conservativeTokenReservation, limits
requiresUserAcceptance: true
```

Render specialist and coordinator text as untrusted text, not HTML. The team identity's static executor-not-connected field must not be mistaken for live runtime status; use the assigned real task state and label actual provider execution explicitly. A review route accepts only queued/runtime-produced task evidence with both specialist and coordinator provenance, never renderer-supplied replacement output.

## Integration requirements

- Block workspace switching, restore and conflicting writers while runtime is active.
- Route running AI task cancellation through this runtime, not raw TaskStore status mutation.
- Abort/drain runtime before quitting or restoring. Shutdown sets its permanent closed gate immediately, including when preparation is delayed or native review is pending. Do not reuse a shut-down runtime.
- Preserve DevelopmentTools' approval callback and backups; do not replace them with a renderer flag.
- Stop at missing credentials/configuration; reuse the user's existing key through the approved secure flow. Never create a new key or make a paid validation call without authorization.

## Verification

Sixteen mocked runtime tests cover specialist/coordinator separation, native acceptance, context service assembly, denial-before-request, file-send denial, traversal/unknown tools, incomplete response rejection, pre-transport budget stop, bounded loops, provider cancellation, cancellation during native edit approval, actual temporary-file edits after approval, and reasoning continuation non-persistence. DevelopmentTools regression tests also pass with optional AbortSignal checks.

No live API calls, credentials, user project writes, or paid operations were used in these tests. Desktop native dialog wiring, UI rendering, Windows behavior, live provider compatibility and actual model output require separate validation.
