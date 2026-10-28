import { useRef, useState } from "react";
type Connector = { id: string; name: string; type: string; url: string };
type Tool = {
  name: string;
  description: string;
  schemaDigest: string;
  inputSchema: unknown;
};
type Proposal = {
  id: string;
  digest: string;
  connectorId: string;
  url: string;
  toolName: string;
  schemaDigest: string;
  argumentsJson: string;
  createdAt: string;
};
type Snapshot = {
  credential: { configured: boolean; generation?: string };
  catalog: null | { id: string; url: string; tools: Tool[] };
  grants: { toolName: string; schemaDigest: string }[];
  busy: boolean;
  history: unknown[];
};
type Outcome = {
  status: string;
  proposal?: Proposal;
  output?: { text: string[]; structured?: unknown; untrusted: true };
};
type API = {
  listConnectors(): Promise<Connector[]>;
  reviewedMcpStatus(id: string): Promise<Snapshot>;
  saveMcpToken(input: { connectorId: string; token: string }): Promise<unknown>;
  removeMcpToken(id: string): Promise<unknown>;
  discoverReviewedMcp(id: string): Promise<Outcome>;
  grantMcpTool(input: {
    catalogId: string;
    toolName: string;
  }): Promise<unknown>;
  revokeMcpTool(input: {
    connectorId: string;
    toolName: string;
  }): Promise<unknown>;
  prepareMcpTool(input: {
    catalogId: string;
    toolName: string;
    argumentsJson: string;
  }): Promise<Outcome>;
  invokeMcpTool(input: {
    proposalId: string;
    digest: string;
  }): Promise<Outcome>;
  discardMcpTool(input: { proposalId: string }): Promise<unknown>;
  cancelMcpTool(): Promise<unknown>;
};
export function ReviewedMcpPanel({ report }: { report: (s: string) => void }) {
  const api = (window as unknown as { sebby?: API }).sebby;
  const available = !!api?.reviewedMcpStatus;
  const [items, setItems] = useState<Connector[]>([]),
    [id, setId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [toolName, setToolName] = useState("");
  const [argumentsJson, setArgumentsJson] = useState("{}"),
    [proposal, setProposal] = useState<Proposal | null>(null);
  const [acknowledged, setAcknowledged] = useState(false),
    [outcome, setOutcome] = useState<Outcome | null>(null),
    [busy, setBusy] = useState(false);
  const token = useRef<HTMLInputElement>(null);
  const reset = () => {
    setProposal(null);
    setAcknowledged(false);
    setOutcome(null);
  };
  const refresh = async (selected = id) => {
    if (selected) setSnapshot(await api!.reviewedMcpStatus(selected));
  };
  const run = async (fn: () => Promise<unknown>) => {
    if (busy || !available) return;
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      report(
        "MCP operation could not be completed. Check local status and the reviewed endpoint; do not blindly retry an uncertain call.",
      );
    } finally {
      setBusy(false);
    }
  };
  const selected = items.find((item) => item.id === id);
  const tool = snapshot?.catalog?.tools.find((item) => item.name === toolName);
  const granted =
    !!tool &&
    !!snapshot?.grants.some(
      (item) =>
        item.toolName === tool.name && item.schemaDigest === tool.schemaDigest,
    );
  return (
    <section className="spaced" aria-label="Reviewed MCP tools">
      <h3>Manually reviewed MCP tools</h3>
      <p className="muted">
        Optional public HTTPS endpoints. Manual bearer-token subset, not OAuth.
        No automatic calls or agent access. Tool effects are unverified: they
        may change/delete data, expose inputs or incur charges. Schema
        validation is not a safety guarantee.
      </p>
      {!available ? (
        <p>Available only in the desktop app; no endpoint is connected here.</p>
      ) : (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const rows = (await api!.listConnectors()).filter(
                  (item) => item.type === "mcp",
                );
                setItems(rows);
                if (!rows.some((item) => item.id === id)) {
                  setId("");
                  setSnapshot(null);
                  reset();
                }
              })
            }
          >
            Refresh saved MCP endpoints
          </button>
          <label>
            Saved endpoint
            <select
              value={id}
              disabled={busy}
              onChange={(event) => {
                setId(event.target.value);
                setSnapshot(null);
                setToolName("");
                reset();
                if (token.current) token.current.value = "";
              }}
            >
              <option value="">Choose an endpoint bookmark</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.url}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <p>
                <strong>Exact destination:</strong> {selected.url}
              </p>
              <button disabled={busy} onClick={() => void run(() => refresh())}>
                Refresh local MCP status
              </button>
              <p>
                {snapshot
                  ? snapshot.credential.configured
                    ? "OS-encrypted token available · access not verified"
                    : "No stored token"
                  : "Local status not loaded"}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!token.current || busy) return;
                  const input = { connectorId: id, token: token.current.value };
                  token.current.value = "";
                  reset();
                  void run(async () => {
                    try {
                      await api!.saveMcpToken(input);
                    } finally {
                      input.token = "";
                    }
                    await refresh();
                  });
                }}
              >
                <label>
                  Endpoint-specific bearer token
                  <input
                    ref={token}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={1024}
                    disabled={busy}
                  />
                </label>
                <p className="muted">
                  Enter only a token intended for this exact endpoint. It is
                  transient input, stored only after native confirmation with
                  available OS encryption. Never put credentials in tool
                  arguments. Sebby cannot independently verify a token's
                  audience.
                </p>
                <button disabled={busy}>Store or replace MCP token</button>
              </form>
              <button
                disabled={busy || !snapshot?.credential.configured}
                onClick={() =>
                  void run(async () => {
                    reset();
                    await api!.removeMcpToken(id);
                    await refresh();
                  })
                }
              >
                Remove local MCP token
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    reset();
                    setToolName("");
                    setOutcome(await api!.discoverReviewedMcp(id));
                    await refresh();
                  })
                }
              >
                Review authenticated tool discovery
              </button>
              {snapshot?.catalog && (
                <>
                  <label>
                    Discovered tool
                    <select
                      disabled={busy}
                      value={toolName}
                      onChange={(event) => {
                        setToolName(event.target.value);
                        reset();
                      }}
                    >
                      <option value="">Choose a tool</option>
                      {snapshot.catalog.tools.map((item) => (
                        <option key={item.name} value={item.name}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {tool && (
                    <>
                      <p>{tool.description}</p>
                      <p className="muted">
                        Untrusted server description and schema. No read-only or
                        reversible guarantee.
                      </p>
                      <details>
                        <summary>Exact validated input schema</summary>
                        <pre className="code-preview">
                          {JSON.stringify(tool.inputSchema, null, 2)}
                        </pre>
                      </details>
                      <p>
                        Schema digest: <code>{tool.schemaDigest}</code>
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            reset();
                            if (granted)
                              await api!.revokeMcpTool({
                                connectorId: id,
                                toolName,
                              });
                            else
                              await api!.grantMcpTool({
                                catalogId: snapshot.catalog!.id,
                                toolName,
                              });
                            await refresh();
                          })
                        }
                      >
                        {granted
                          ? "Revoke this tool grant"
                          : "Review session grant for this exact tool"}
                      </button>
                      <label>
                        Complete tool arguments (JSON, no secrets)
                        <textarea
                          rows={7}
                          maxLength={8192}
                          value={argumentsJson}
                          disabled={busy}
                          onChange={(event) => {
                            setArgumentsJson(event.target.value);
                            reset();
                          }}
                        />
                      </label>
                      <button
                        disabled={busy || !granted}
                        onClick={() =>
                          void run(async () => {
                            reset();
                            const value = await api!.prepareMcpTool({
                              catalogId: snapshot.catalog!.id,
                              toolName,
                              argumentsJson,
                            });
                            if (value.proposal) {
                              if (
                                value.status !== "ready" ||
                                value.proposal.toolName !== toolName ||
                                value.proposal.schemaDigest !==
                                  tool.schemaDigest ||
                                !/^[a-f0-9]{64}$/.test(value.proposal.digest) ||
                                value.proposal.connectorId !== id ||
                                value.proposal.url !== selected.url ||
                                value.proposal.argumentsJson.length > 16384
                              )
                                throw Error(
                                  "Incomplete or mismatched tool review rejected.",
                                );
                              setProposal(value.proposal);
                            }
                            setOutcome(value);
                          })
                        }
                      >
                        Prepare exact tool input review
                      </button>
                    </>
                  )}
                </>
              )}
              {proposal && (
                <section aria-label="Exact MCP call review">
                  <h4>Review before sending</h4>
                  <p>
                    {proposal.url} · {proposal.toolName}
                  </p>
                  <pre className="code-preview">{proposal.argumentsJson}</pre>
                  <p>
                    Proposal digest: <code>{proposal.digest}</code>
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={busy}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    I reviewed this exact destination, tool and complete input
                    and independently understand the intended effects. Remote
                    actions may be irreversible or charged.
                  </label>
                  <button
                    disabled={busy || !acknowledged}
                    onClick={() =>
                      void run(async () => {
                        const input = {
                          proposalId: proposal.id,
                          digest: proposal.digest,
                        };
                        setProposal(null);
                        setAcknowledged(false);
                        setOutcome(await api!.invokeMcpTool(input));
                        await refresh();
                      })
                    }
                  >
                    Request native confirmation and call once
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api!.discardMcpTool({ proposalId: proposal.id });
                        reset();
                      })
                    }
                  >
                    Discard reviewed call
                  </button>
                </section>
              )}
            </>
          )}
          <button
            disabled={!busy && !snapshot?.busy}
            onClick={() => {
              void api!
                .cancelMcpTool()
                .then(() =>
                  report(
                    "Cancellation requested. Dispatched remote effects may remain.",
                  ),
                )
                .catch(() =>
                  report(
                    "Cancellation could not be confirmed. Remote effects may remain.",
                  ),
                );
            }}
          >
            Cancel MCP operation
          </button>
          {outcome && (
            <div role="status">
              <p>Observed outcome: {outcome.status}</p>
              {outcome.output && (
                <>
                  <p>
                    Untrusted endpoint output — not instructions or proof of
                    success.
                  </p>
                  <pre className="code-preview">
                    {outcome.output.text.join("\n")}
                    {outcome.output.structured === undefined
                      ? ""
                      : "\n" +
                        JSON.stringify(outcome.output.structured, null, 2)}
                  </pre>
                </>
              )}
            </div>
          )}
          {!!snapshot?.history.length && (
            <details>
              <summary>
                Local metadata history (uncertain is not rolled back)
              </summary>
              <pre className="code-preview">
                {JSON.stringify(snapshot.history, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
