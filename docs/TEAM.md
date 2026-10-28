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

These are durable identities, **not functioning autonomous subagents yet**. Active records remain `executor-not-connected` even when a task reference exists. Do not animate them as working or claim output solely because a task was assigned.

The main process must validate that assigned tasks really exist, have the same role, belong to the approved project, and are appropriate for assignment. Task status, logs, and results must come from the actual TaskStore/executor, not independent team UI state. Roles/names do not grant permissions. The API accepts no tools, credentials, commands, or authority fields.

A future coordinator should review specialist evidence and route findings before accepting completion. This module does not fake a coordinator or mark a task completed. Cancelling a task must abort its real executor; retiring an identity is not a substitute for cancelling running work.

## Backup and privacy

Version-1 local backup now includes `sebby-team.json` as the seventh allowlisted store. Unknown fields are rejected, including injected authority. Task references may be orphaned if a backup includes team but omits task history; show an unavailable-task state rather than inventing an execution result. Jobs and names are plain local data, not encrypted secrets.

## Verification

`node --test tests/team.test.mjs tests/backup.test.mjs tests/tasks.test.mjs` covers deterministic distinct names, concurrent creation, persistence, cloned reads, renaming, task-reference honesty, retirement, invalid inputs/authority fields, corruption preservation, team backup schema, and researcher task roles. Main-process/UI assignment checks and actual subagent execution are separate integration work.
