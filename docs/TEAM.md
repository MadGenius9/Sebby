# Sebby's named specialist team

Sebby can assign persistent names and jobs to specialist identities. Names come from an authored, deterministic pool—not model generation. The first planner is **Mira**, coder **Finn**, reviewer **Sage**, and researcher **Nova**. The UI should label these names “Sebby assigned.” User renames are separately marked.

## Implemented contract

`TeamStore(directory)` owns `sebby-team.json` in app data. Call `load()` first.

- `list()` / `get(id)` return cloned identity records.
- `create({role,job})` assigns an unused authored name for planner/coder/reviewer/researcher.
- `rename(id,name)` validates a distinct short name and marks `nameOrigin: user-renamed`.
- `assignTask(id,taskId|null)` records or clears a UUID task reference. It does not execute anything.
- `retire(id)` marks retired and clears the task reference. Retired identities stay in history and cannot be renamed/reassigned.

Record fields:

```text
id: UUID
name: display name
nameOrigin: sebby-assigned | user-renamed
role: planner | coder | reviewer | researcher
specialty: fixed human-readable description of the role
job: user-approved description, 1–2000 bytes
status: executor-not-connected | retired
assignedTaskId: UUID | null
createdAt, updatedAt: epoch milliseconds
```

The maximum is 32 identities including retired members, with eight authored names per role. Names must be distinct (case-insensitive). Concurrent writes serialize, and atomic replacement commits the validated snapshot. Malformed linked/oversized/corrupt storage fails closed without overwriting it.

## Honest execution state

These are durable identities connected to the implemented, approval-gated `AgentRuntime` and deterministic `LocalExecutor`. The legacy stored value `executor-not-connected` is static identity metadata, **not live provider status**. The UI derives activity and review state from the actual assigned TaskStore record. A name or assignment alone does not start work or prove a provider is configured. Live model connectivity has not been tested; mocked tests establish runtime behavior only.

The main process must validate that assigned tasks really exist, have the same role, belong to the approved project, and are appropriate for assignment. Task status, logs, and results must come from the actual TaskStore/executor, not independent team UI state. Roles/names do not grant permissions. The API accepts no tools, credentials, commands, or authority fields.

For a configured and explicitly approved AI run, the implemented runtime makes a specialist request and a separate real provider coordinator-review request. Both outputs and evidence remain awaiting-review until native user acceptance. No coordinator response is fabricated when a provider is missing. TeamStore itself never marks tasks completed. Cancelling a task must abort its real executor; retiring an identity is not a substitute for cancelling running work.

If an AI run omits a selected identity, Sebby reuses the task’s assigned matching specialist or creates a distinct authored name and local job description before approval. Denial leaves an unused local identity but no provider call or running task. The same idle identity can be reused for that task rather than consuming a new name on each denied attempt.

## Backup and privacy

Version-1 local backup now includes `sebby-team.json` among the fixed allowlisted stores. Unknown fields are rejected, including injected authority. Task references may be orphaned if a backup includes team but omits task history; show an unavailable-task state rather than inventing an execution result. Jobs and names are plain local data, not encrypted secrets.

## Verification

`node --test tests/team.test.mjs tests/backup.test.mjs tests/tasks.test.mjs` covers deterministic distinct names, concurrent creation, persistence, cloned reads, renaming, task-reference honesty, retirement, invalid inputs/authority fields, corruption preservation, team backup schema, and researcher task roles. Runtime mocked tests additionally cover named execution, separate coordinator calls, context consent, bounded tools, cancellation, and acceptance. No real provider authentication, model quality, or native Windows behavior is established by those tests. See [agent runtime](AGENTS.md).
