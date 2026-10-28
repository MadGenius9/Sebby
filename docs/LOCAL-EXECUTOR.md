# Deterministic local utilities

Sebby can execute two **actual, bounded, read-only local utilities without an AI provider**. These are not model reasoning or autonomous specialist agents:

- **Workspace inventory** (`workspace-inventory`): observes supported file paths and sizes returned by the selected workspace service. Role: researcher; task kind: `local-inventory`.
- **Project brief template** (`project-brief`): returns an explicitly unfilled planning template plus observed inventory. It does not infer requirements or generate an app plan. Role: planner; task kind: `local-brief`.

No source file contents, network requests, shell commands, connector calls, or project writes occur in either utility. Local task/log persistence is the only write. Inventory counts describe returned allowlisted metadata, not all project files. The underlying workspace cap is 300 returned files with depth/scan/extension/size/symlink/sensitive-name exclusions; reports include at most 20 KB of path rows. Files can change after observation.

## Main-process contract

```js
const executor = new LocalExecutor({tasks, team, workspace,
  approve: async details => nativeUtilityApproval(details)
});
const run = await executor.startNew({kind:'workspace-inventory', memberId});
if (run.started) {
  const task = await executor.wait(run.runId);
  // status awaiting-review is not completed
  await executor.review(task.id, {
    approveReview: async evidence => nativeResultReview(evidence)
  });
}
```

Methods/getters:

- `startNew({kind,memberId?})`: prompts before creating and starting a dedicated exact utility task. Only one run may start at a time. Approval details identify utility, workspace and specialist. Denied approval creates no task.
- `wait(runId)`: waits for execution result; at most 20 run promises are retained in memory. Persistent task history remains authoritative after restart.
- `cancel(taskId)`: aborts the actual in-progress traversal cooperatively and waits for the task to record cancellation. It is not merely a visual status change.
- `review(taskId,{approveReview})`: displays actual evidence and its hash for separate native review, rechecks unchanged state/evidence afterward, then marks only this utility completed. Declining leaves it awaiting review.
- `isActive`, `activeCount`: include a running/pending-approval utility and open result reviews; use for write/restore guards.
- `shutdown()`: aborts and drains an active scan. Pending native approval/review must be closed first; it throws rather than falsely claiming all work stopped.

The main process must guard workspace switches and backup/restore while execution is active; also use the normal native-dialog guard. The executor independently checks workspace identity before and after scanning. Native filesystem calls already in flight cannot be forcibly interrupted; the traversal checks `AbortSignal` between operations and discards cancelled output. No auto-start occurs when a task is queued or when Sebby restarts.

## Task and identity semantics

`TaskStore.kind` is `ai` for existing/default tasks. Local utilities create separate tasks with controlled title, prompt, role, and immutable local kind. There is no public run-existing-goal method: asking “build an app” cannot silently become a completed inventory. Completion of a utility never completes its broader project goal.

Lifecycle now includes `running → awaiting-review → completed`. Direct running-to-completed is rejected. Awaiting-review requires a real result and survives restart; running becomes interrupted as before. Main IPC must never expose arbitrary task transition methods. Local review rejects AI tasks and mismatched title/prompt/role metadata.

Optional named specialists must be active, unassigned, and match the utility role. Assignment links the identity to the utility task only. The team record remains `executor-not-connected`: the name is a role/ownership label, not evidence that an AI agent ran. UI should display actual task status/log/result and clearly label local deterministic utility execution. Automatic AI coordinator review remains unimplemented; this build uses explicit human review through Sebby and does not fake intelligence.

Results are stored as plain text with observed timestamp, run ID, workspace, bounded file rows, size counts, limitations, and SHA-256 evidence hash in task logs. This is not a signed forensic snapshot or an adversarial filesystem sandbox.

## Verification

`node --test tests/local-executor.test.mjs tests/tasks.test.mjs tests/backup.test.mjs`: 18 tests passed at implementation. Six new local-executor cases verify real temporary workspace inventory; no content leaks; unrelated app tasks remain queued; approval denial; mismatched specialist; explicit unfilled template; AbortSignal cancellation; workspace changes; review persistence; and already-aborted workspace scan rejection. Full suite and UI/native-dialog verification are integration checks, not assumed by these tests.
