# Sequential multi-specialist orchestration

This workflow coordinates one to four named specialists using the existing provider-backed task runtime. It does **not** grant agent-generated delegation, parallel execution, shell access, connector permissions, GitHub publication, installations, or automatic acceptance. Tests use fake providers and real temporary task/team stores; no paid calls or accounts were used.

## What actually happens

1. The user defines an ordered plan with fixed roles (`planner`, `researcher`, `coder`, `reviewer`), prompts, context scopes and individual limits. Native plan consent approves its immutable digest and conservative total reservation; this is not consent to send any request yet.
2. The user starts the next child. A real queued AI task is created and the existing `AgentRuntime.start` selects/assigns a real named team member. Existing native provider/context consent, per-file context consent, reviewed-edit consent and tool budgets remain in force. A child cannot widen the plan's scope ceiling; only a coder may request reviewed edits.
3. The existing runtime performs the specialist loop plus its separate, tool-free coordinator critique. Only actual complete provider results with matching run/model/member provenance move the child to `awaiting-step-review`.
4. Native child acceptance goes through the existing runtime review flow. The next child cannot begin before acceptance. The immediately preceding accepted result is included as explicitly **untrusted evidence**, with task identity and exact result hash, in the next child's prompt and native outgoing-context disclosure. It is not a system instruction or transferable permission.
5. After every child is accepted, the user separately approves exactly **one additional tool-free final provider critique** of the goal and accepted evidence. This request is budgeted upfront and has independent native context/cost consent. It does not reread files or run tools.
6. A complete final response with a real response ID is stored with usage (or explicitly unknown usage) and a digest. Separate native final acceptance is required to mark the plan completed. Completion means the user accepted the recorded work and critique—not that the goal is correct, secure, tested, deployed or independently verified.

Denial never counts as acceptance. Failed, cancelled, interrupted or over-budget work is not retried automatically. Already approved edits can remain after cancellation or failure.

## Identity, scopes and budgets

Each plan is bound to an exact workspace, provider, profile UUID, main-computed profile revision and model. There is no renderer-selected model override. The main revision hashes nonsecret profile settings and a session/credential-settings generation; changing settings invalidates a stale plan rather than silently switching providers. Credentials are resolved only inside existing main-process provider adapters and are never stored in orchestration records.

Each child's `contextOptions` is a subset of the plan ceiling: memory, read-tool permission, edit permission, selected skill IDs and initial attached file paths. **Initial file allowlists limit attachments, not all later workspace reads.** Enabling read tools authorizes only the existing bounded workspace read surface, with the existing separate native approval for each file sent to the provider. It is not connector/network authority. Imported skills, prior results, local files and memory remain untrusted content.

The entire reservation is calculated upfront: sum of every child's `maxCalls` and `maxTotalTokens`, including each child's existing coordinator, plus one final call and its declared token reservation. Bounds:

- At most four children; each 2–6 calls, 128–3,000 maximum output tokens per call, 1,000–200,000 conservative total tokens.
- Whole plan at most 25 provider calls and 1,000,000 conservative reserved tokens. These are **not prices or guaranteed billing caps**. The existing runtime uses conservative context reservations and records reported usage when available; provider accounting may differ.
- Final call 128–3,000 maximum output tokens and 1,000–200,000 conservative total tokens. Its exact outgoing context reservation must fit before dispatch. Reported usage exceeding the declared allowance prevents acceptance and further progress; an already incurred charge cannot be undone.
- No refund/reallocation of unused child reservations to later children. No automatic retries or extra model-generated steps. A native denial before execution may be reconsidered for the same still-unexecuted step; it does not create an extra attempt.

## Evidence and bounds

User goal and each step prompt are bounded to 4,000 UTF-8 bytes. The combined child task prompt must fit the existing 16,000-byte task cap. The immediately preceding accepted result—including specialist text, coordinator critique and recorded tool evidence—is limited to 10,000 bytes for handoff. Oversized handoff fails explicitly; there is no silent truncation or hidden paid summarization.

Final evidence is the full bounded manifest of accepted children, their actual names/roles, provider result IDs, tool evidence and hashes, limited to 56,000 bytes. Final critique text is limited to 24,000 bytes. Unknown usage remains `null`; empty check evidence does not imply tests passed. Result hashes establish stable recorded evidence, not the current state of every workspace file.

Between steps, the user may change source files. The next child rebuilds its context and receives fresh native disclosure through the existing runtime. Earlier results describe their earlier observed state; handoff does not silently assert that source is unchanged. The final critique is of accepted evidence, not a new workspace inspection.

## Main-process adapter contract

```text
new OrchestrationService({
  directory, tasks, runtime, getIdentity,
  approvePlan, approveFinalRequest, aggregateProvider,
  approveFinalAcceptance, onEvent
})
```

- `getIdentity()` returns exactly `{workspaceRoot,profileId,profileRevision,provider,model}`. `profileRevision` is a 64-hex digest computed by main, not renderer input.
- `runtime.start(input, {signal, identity})`, `runtime.wait(runId)`, `runtime.cancel(taskId)`, `runtime.review(taskId,{approveReview})`, `runtime.isActive` wrap the existing runtime. **The second start argument is a required integration guard:** a stock runtime may await credential status before its active run exists. Main must check this signal and locked identity before/after status, before/after native approvals, and before every provider send. Combine it with the runtime's signal. Otherwise cancellation during early preparation could be followed by a later consent dialog or request.
- `aggregateProvider({identity,input,instructions,maxOutputTokens,signal})` resolves the pinned profile in main and sends only `tools:[]`; it must check identity before/after and honor cancellation. Returned status/text/responseId/usage are validated. Tool-bearing outputs fail rather than becoming extra actions. No credentials or provider-selection callback is available in the renderer.
- Native approval callbacks require strict `true`. `approvePlan` receives the immutable definition/digest; `approveFinalRequest` receives exact accepted context/digest, byte counts, limits and cost warning; `approveFinalAcceptance` receives actual final critique and evidence.
- `onEvent(status)` is a lifecycle notification, not a command or approval source.

Methods:

- `load()`, `list()`, `get(planId)`, `status()`, `isBusy`.
- `create({goal,steps,grantCeiling,budget,finalLimits})` -> `{created,plan}`. Each step is `{role,title,prompt,contextOptions,limits}`. The ceiling is `{includeMemory,allowReadTools,allowEdits,skillIds,filePaths}`; budget is `{maxCalls,maxTotalTokens}`; final limits are `{maxOutputTokens,maxTotalTokens}`.
- `startNext({planId,digest})` -> `{started,runId,taskId,plan}`. `wait(planId)` waits for the retained background child/final operation and returns current plan state.
- `acceptStep({planId,taskId,resultDigest},{approveReview})` -> `{reviewed,plan}`. The second argument is main-only native capability, never renderer input.
- `finalize({planId,aggregateDigest})` -> `{started,reviewRunId,plan}`.
- `acceptFinal({planId,finalResultDigest})` -> `{accepted,plan}`.
- `cancel({planId})`, `shutdown()`; cancellation requests stop but does not claim a still-running provider has finished. Busy remains true until the actual adapter drains.

States: `ready`, `running`, `awaiting-step-review`, `ready-final`, `finalizing`, `awaiting-final-review`, `completed`, `failed`, `cancelled`, `interrupted`. There is only one nonterminal plan and one pending operation at a time. Main must also prevent competing chat/manual-agent/tool/file/settings/backup operations during active child work or a native acceptance operation. A post-launch persistence error cancels and waits for the actual child before releasing the execution lock.

## Persistence and restart

`sebby-orchestration.json` is a strict, bounded 4 MiB store of at most 20 plans. It contains user-authored goal/prompts and scope metadata, locked nonsecret profile identity, task/run/member IDs, accepted result hashes and the actual final critique. Existing task storage retains full child results. No API keys, authorization headers, provider vault data, or automatically copied workspace source files are stored here. User text and model output can themselves contain sensitive information; this ordinary app-data file is **not** a secret vault.

Atomic restrictive-permission writes are fsynced before rename. Unknown fields, malformed records, invalid digests, oversized data and symlink stores are rejected without overwriting the original. Local filesystem checks are not a guarantee against a malicious same-user process racing or tampering with all app data.

On load, every nonterminal plan becomes `interrupted`, including pending acceptance. Nothing is resumed, retried, sent or accepted automatically. Previous child tasks and approved edits remain visible for review. The original approvals cannot be reused by restarting. The store is not automatically included in existing backup restore; any future import needs a separate interrupted-only validator and must not import execution authority.

## Test evidence

Service tests use real local TaskStore, TeamStore and AgentRuntime with injected fake provider responses. Coverage includes sequential role/name persistence, scope ceilings, conservative aggregate budgets, untrusted accepted handoff, exact digests, native denials, identity/context drift, real provenance requirements, separate final acceptance, cancellation before/after dispatch, restart without replay, malformed/symlink storage and explicit overflow rejection. Integration guards must additionally test cancellation while credential status is pending and locked provider identity before every send.

No live API call, real provider billing, Windows executable, external connector invocation or native desktop usability is established by these tests.
