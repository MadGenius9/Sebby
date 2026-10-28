import { useEffect, useState } from "react";
import { connectors, type Connector } from "./bridge";
export function ConnectorBookmarks({
  report,
}: {
  report: (s: string) => void;
}) {
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
