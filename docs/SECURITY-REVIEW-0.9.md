# Independent source review — reviewed MCP, coordination and isolation preparation

Reviewed the new main-process services, IPC boundaries and integration as source. This is not a penetration-test certification or proof of native containment. No real credentials, provider/MCP requests, container engine, image, Windows process or recording was used.

## Evidence

`node --test tests/orchestration*.test.mjs tests/mcp-reviewed*.test.mjs tests/isolation*.test.mjs`: **68 passed, 0 failed**, including nine independently authored adversarial regressions in `orchestration-security.test.mjs`, `mcp-reviewed-security.test.mjs`, and `isolation-security.test.mjs`. Tests use temporary local fixtures and injected fake transports. Other checkpoint-wide checks are recorded separately by the integrator.

## Findings corrected before checkpoint

- MCP journal capacity now fails closed instead of evicting unresolved remote-effect evidence. Approval is strict boolean true, cancelled slow binding checks cannot open later consent, and loaded journal identities/metadata are validated.
- MCP token input is cleared synchronously before queued consent work, encryption/storage errors are sanitized, local reads explicitly reject linked files, and structured output is bounded. Duplicate/prototype JSON keys and unsupported schema constructs are rejected. String bounds count Unicode code points; directional controls are escaped in review without changing sent values.
- Isolation test-run preparation revalidates the exact approved executable, hash, image and daemon configuration after consent rather than silently using a stale configuration. Snapshot/artifact paths reject directional and zero-width review spoofing. Staging is bounded; stale directories count against retention rather than restoring authority.
- Orchestration store loading explicitly checks link/type/size before opening and compares descriptor identity. Cancellation after delayed identity resolution cannot persist a newly approved plan.
- Independent integration regressions demonstrate that cancellation during native child consent and internal profile drift during delayed credential status both prevent dispatch. Per-send pinned identity checks and combined abort signals are present in the main-only child adapter.

## Boundaries retained

**MCP:** manual calls only, dedicated encrypted endpoint/generation-bound bearer, session-only tool grants, immutable bounded arguments and exact digest, native unknown-effect/cost warning, durable intent before one attempt and no automatic retry. No tool result grants authority. Credential-shaped input detection is partial, not reliable secret discovery. A remote tool can be destructive or costly; schema validation does not establish safety or reversibility. Cancellation does not undo remote work. Compatibility with real servers and native secure-storage behavior remain unverified.

**Coordination:** one to four sequential named specialists, immutable scope ceiling and conservative reservations, separate existing child provider/tool approvals, matching stored provenance and accepted-result digests, then one separately approved tool-free critique and separate final acceptance. Prior results are untrusted evidence, not instructions or permissions. Initial file lists limit attachments, not every later read enabled by explicit read-tool permission. Restart interrupts without replay. Acceptance is not proof of correct code or executed tests. Token reservations are not guaranteed monetary caps. User edits between steps can make earlier evidence stale; the final critique does not independently inspect the workspace.

**Isolation:** production execution is unavailable unconditionally. IPC exposes configuration and consented local snapshot preparation/verification/disposal, not a runner or injectable transport. Fake lifecycle tests do not validate Docker, kernel isolation, image provenance, recipes or escape resistance. A daemon socket is privileged host authority. Fixed UID 65532 cannot yet be assumed to read host-owned mode-0400 staged files: a tested least-privilege delivery/mapping design remains a blocking native gate, not a reason to make source world-readable. No host project/socket mount or actual engine invocation was introduced.

Local link/identity checks and restrictive modes are defense in depth, not a sandbox against a hostile same-user process racing all app files. JavaScript secret strings cannot be guaranteed zeroed. Native Electron permission dialogs, Windows encrypted storage, cancellation/cleanup behavior and all live endpoint/engine compatibility still require explicit authorized testing on the target environment.
