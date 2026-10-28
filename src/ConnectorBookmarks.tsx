import { useEffect, useState } from "react";
import {
  connectors,
  discovery,
  type McpSnapshot,
  type Connector,
} from "./bridge";
export function ConnectorBookmarks({
  report,
}: {
  report: (s: string) => void;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, McpSnapshot>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [items, setItems] = useState<Connector[]>([]),
    [name, setName] = useState(""),
    [type, setType] = useState<"github" | "mcp">("github"),
    [url, setUrl] = useState("");
  async function load() {
    if (connectors)
      try {
        setItems(await connectors.listConnectors());
      } catch (e) {
        report((e as Error).message);
      }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <h3 className="spaced">Prepare a connection</h3>
      <p className="muted">
        Save a repository or MCP endpoint bookmark for later. Saving does not
        contact it, authenticate, grant permissions, or enable tools. No tokens
        or secrets.
      </p>
      {!connectors ? (
        <p className="muted">
          Connector bookmarks are available in the desktop app.
        </p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Name
              <input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "github" | "mcp")}
              >
                <option value="github">GitHub repository</option>
                <option value="mcp">MCP endpoint</option>
              </select>
            </label>
          </div>
          <label className="field-label" htmlFor="connector-url">
            Public HTTPS URL, without credentials
          </label>
          <input
            id="connector-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="primary spaced"
            onClick={async () => {
              try {
                await connectors!.addConnector({ name, type, url });
                setName("");
                setUrl("");
                await load();
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            Save bookmark
          </button>
          {items.map((item) => (
            <article className="skill" key={item.id}>
              <small>{item.type} · Configured—not connected</small>
              <h3>{item.name}</h3>
              <p>{item.url}</p>
              <p>
                Requested future scope: {item.requestedScopes.join(", ")} · no
                grant made
              </p>
              {item.type === "mcp" && discovery && (
                <div className="callout">
                  <h3>Read-only tool discovery</h3>
                  <p>
                    Fetch tool names and descriptions only after native consent.
                    No authentication, project context, or tool execution.
                    JSON-only MCP 2026-07-28 subset.
                  </p>
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={checking !== null}
                      onClick={async () => {
                        setChecking(item.id);
                        try {
                          const result = await discovery!.discoverMcp(item.id);
                          setSnapshots((current) => ({
                            ...current,
                            [item.id]: result,
                          }));
                        } catch (e) {
                          report((e as Error).message);
                        } finally {
                          setChecking(null);
                        }
                      }}
                    >
                      {checking === item.id
                        ? "Inspecting…"
                        : "Inspect tool names…"}
                    </button>
                    {(checking === item.id || snapshots[item.id]) && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            const result = await discovery!.disconnectMcp(
                              item.id,
                            );
                            setSnapshots((current) => ({
                              ...current,
                              [item.id]: result,
                            }));
                          } catch (e) {
                            report((e as Error).message);
                          }
                        }}
                      >
                        {checking === item.id
                          ? "Cancel request"
                          : "Clear discovery"}
                      </button>
                    )}
                  </div>
                  {snapshots[item.id] && (
                    <>
                      <p role="status">
                        {snapshots[item.id].status === "connected-read-only"
                          ? "Catalog checked · read-only, no persistent session"
                          : snapshots[item.id].status}
                        {snapshots[item.id].checkedAt
                          ? " · " +
                            new Date(
                              snapshots[item.id].checkedAt!,
                            ).toLocaleString()
                          : ""}
                      </p>
                      {snapshots[item.id].error && (
                        <p>{snapshots[item.id].error}</p>
                      )}
                      {snapshots[item.id].truncated && (
                        <p>
                          Partial catalog. Pagination or additional tools were
                          not fetched.
                        </p>
                      )}
                      <details>
                        <summary>
                          Untrusted server descriptions (
                          {snapshots[item.id].tools.length})
                        </summary>
                        {snapshots[item.id].tools.map((tool, index) => (
                          <div key={index}>
                            <h4>{tool.name}</h4>
                            <p>
                              {tool.description || "No description supplied."}
                            </p>
                          </div>
                        ))}
                      </details>
                    </>
                  )}
                </div>
              )}
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await connectors!.removeConnector(item.id);
                    await load();
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                Remove bookmark…
              </button>
            </article>
          ))}
        </>
      )}
    </>
  );
}
