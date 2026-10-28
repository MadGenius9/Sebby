import { McpDiscovery } from "./mcp-discovery.mjs";
/** Read-only, explicit main-process network exception. Renderer networking remains denied. */
export function installNetworkFeatures({
  connectors,
  register,
  confirm,
  isExternalBusy = () => false,
}) {
  const discovery = new McpDiscovery({
    connectors,
    approve: ({ name, url, description }) =>
      confirm(
        "Inspect this MCP endpoint?",
        `${name}\n${url}\n\n${description}\n\nThe endpoint and DNS infrastructure can see network metadata, including your IP. Only contact endpoints you trust; any endpoint-side charges are your responsibility. No credentials or project data will be sent. This grants one discovery attempt, not tool execution.`,
      ),
  });
  register("discover-mcp", (id) => {
    if (isExternalBusy()) throw Error("Finish active reviewed MCP work first.");
    return discovery.discover(id);
  });
  register("mcp-status", (id) => {
    connectors.get(id);
    return discovery.status(id);
  });
  register("disconnect-mcp", (id) => {
    connectors.get(id);
    return discovery.disconnect(id);
  });
  return discovery;
}
