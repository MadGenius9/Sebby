# Durable tasks and instruction skills

These modules are local services. They do not independently execute models, shell commands, connectors, imported scripts, or agents. A task marked completed must come from a real executor and evidence, not a timer or a canned response.

## TaskStore

```js
import {TaskStore} from './electron/tasks.mjs';
const tasks = new TaskStore(app.getPath('userData'));
await tasks.load();
const task = await tasks.create({
  title: 'Review selected source',
  prompt: 'Find correctness defects. Do not modify files.',
  role: 'reviewer', // planner | coder | reviewer | researcher
  workspace: selectedWorkspacePath // optional metadata only
});
// The approved executor, not arbitrary renderer input, controls these:
await tasks.transition(task.id, 'running');
await tasks.appendLog(task.id, {level: 'info', message: 'Read the approved file.'});
await tasks.transition(task.id, 'completed', {result: 'Evidence-backed result'});
```

Methods: `load`, `list`, `get(id)`, `create(input)`, `transition(id,status,{message?,result?})`, `appendLog(id,{level,message})`, `remove(id)`. Reads return clones. Mutations serialize and write a unique temporary file followed by rename. Errors preserve the previously committed state. One process/instance owns each store; this is not a multi-process database.

### Lifecycle

- queued → running or cancelled
- running → completed, failed, cancelled, or interrupted
- interrupted → queued or cancelled
- failed → queued
- completed and cancelled → no further transitions

Running tasks become interrupted when storage loads after restart. They are **never automatically replayed**; prior side effects may already have happened. Queued tasks remain queued. Retrying increments the attempt count only when work really starts. Active queued/running tasks must be cancelled before removal. Task cancellation records intent/status; the integrating executor must also abort its actual in-flight operation. No module can terminate a subprocess it does not own.

Limits: 100 tasks, 100 latest log entries per task, 160-byte title, 16 KB prompt, 32 KB result, 2 KB log entries, 4 MiB total JSON. Workspace values are metadata, not trusted grants of filesystem access. Roles are labels and prompts, not privileges. Do not return raw secrets in logs/results. A future executor must separately enforce selected workspace, tool policy, credentials, usage limits, and human approvals.

### IPC integration rule

Expose create/list and intention-specific cancel/retry operations to the renderer. Do **not** expose generic transition-to-completed or transition-to-running APIs. Only the trusted execution layer can establish actual execution and completion. Validate workspace from current main-process selection instead of accepting a renderer-supplied path as authority. Require explicit review before retrying an interrupted action with possible side effects.

## SkillRegistry

```js
import {SkillRegistry} from './electron/skills.mjs';
const skills = new SkillRegistry(app.getPath('userData'));
await skills.load();
const imported = await skills.importSkill({
  id: 'user-accessibility-review',
  name: 'Accessibility review',
  description: 'Inspect keyboard access and semantic structure.',
  instructions: 'Review keyboard access. Report findings without editing files.'
});
```

Methods: `load`, `list`, `get(id)`, `importSkill(input)`, `remove(id)`. Imported documents accept exactly id/name/description/instructions. IDs require a `user-` prefix. Executable/permission/trust fields are rejected, not ignored. Imports are always `origin: user`, `trust: untrusted`, `readOnly: false`. Existing IDs cannot be overwritten implicitly. Bundled app-plan/code-review/project-brief are loaded from packaged Markdown files and cannot be removed through this API.

Limits: 50 imported skills, 32 KB instructions per skill, 2 MiB total JSON. Built-in playbooks are `trust: bundled-instructions`; this means shipped source provenance, **not authorization**. Every skill remains instruction content subordinate to user/system policy. Imported text may contain prompt injection; displaying or including it does not make it safe. No YAML parser, dependency installation, script hooks, remote URLs, or dynamic module loading are used.

For model integration, explicitly label imported text as untrusted and keep it out of privileged system instructions. User approval for using a skill is not approval for any requested command or connector operation. Render instruction text as text, not HTML.

## Persistence and recovery

Files: `sebby-tasks.json` and `sebby-skills.json` in app data. Both are plain local JSON; prompts/results may be sensitive and are **not encrypted**. Malformed, oversized, or linked store files fail closed on load and are not silently overwritten. Preserve the file and resolve corruption before retrying. This is not a backup system or a race-free hostile filesystem sandbox.

## Verification

`node --test tests/tasks.test.mjs tests/skills.test.mjs` — eight tests passing. Covers lifecycle, restart interruption, no replay, retry attempts, durable clone-safe state, concurrent writes, log bounds, invalid payloads, corruption preservation, bundled immutability, import persistence, trust spoofing, executable-field rejection, ID traversal, and bounded instruction text. No external network/API call was made. End-to-end UI/executor integration is separately owned by the main app integration.
