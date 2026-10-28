import { McpReviewed } from "./mcp-reviewed.mjs";
import { McpVault } from "./mcp-vault.mjs";
/** Manual tool calls only. No model/runtime receives this service or its credential handle. */
export async function installReviewedMcp({
  directory,
  safeStorage,
  connectors,
  register,
  confirm,
  isExternalBusy = () => false,
  serviceOptions = {},
}) {
  let closed = false,
    pending = null;
  const approve = async (request) => {
    if (closed) return false;
    const accepted = await confirm(
      "Review this MCP operation and exact destination",
      `${JSON.stringify(request, null, 2)}\n\nServer descriptions, annotations and schemas are untrusted. Sebby cannot verify the tool's effects or whether it is safe, read-only, reversible or free. A tool call may change or delete remote data, notify others, expose the reviewed arguments or incur costs. Only proceed if you independently understand and authorize this exact tool and input. Cancellation cannot undo remote work. No automatic retry, model delegation, OAuth registration or challenge redirect is permitted.`,
    );
    return accepted === true && !closed;
  };
  const vault = new McpVault({ directory, safeStorage, connectors, approve });
  await vault.load();
  const service = new McpReviewed({
    directory,
    connectors,
    vault,
    ...serviceOptions,
    approve,
  });
  await service.load();
  const busy = () => !!pending || service.isBusy();
  const exclusive = (fn) => (input) => {
    if (closed) throw Error("Reviewed MCP is closing.");
    if (busy() || isExternalBusy())
      throw Error("Finish or cancel the active MCP operation first.");
    // Reserve synchronously, including while a native dialog is pending.
    let resolve, reject;
    const operation = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pending = operation.finally(() => {
      pending = null;
    });
    const result = pending;
    try {
      Promise.resolve(fn(input)).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return result;
  };
  register("reviewed-mcp-status", (id) => service.status(id));
  register(
    "save-mcp-token",
    exclusive(async (input) => {
      const result = await vault.save(input);
      service.clearConnector(input.connectorId);
      return result;
    }),
  );
  register(
    "remove-mcp-token",
    exclusive(async (id) => {
      const result = await vault.remove(id);
      service.clearConnector(id);
      return result;
    }),
  );
  register(
    "discover-reviewed-mcp",
    exclusive((id) => service.discover(id)),
  );
  register(
    "grant-mcp-tool",
    exclusive((input) => service.grant(input)),
  );
  register(
    "revoke-mcp-tool",
    exclusive((input) => service.revoke(input)),
  );
  register(
    "prepare-mcp-tool",
    exclusive((input) => service.prepare(input)),
  );
  register(
    "invoke-mcp-tool",
    exclusive((input) => service.invoke(input)),
  );
  register(
    "discard-mcp-tool",
    exclusive((input) => service.discard(input)),
  );
  register("cancel-mcp-tool", () => service.cancel());
  return {
    service,
    vault,
    isBusy: busy,
    beforeRemoveConnector: async (id) => {
      if (closed || busy() || isExternalBusy())
        throw Error("Finish active MCP work before removing a connector.");
      if (
        connectors.get(id).type === "mcp" &&
        (await vault.status(id)).configured
      )
        throw Error(
          "Remove this endpoint’s local MCP token before removing its bookmark.",
        );
      if (closed || busy() || isExternalBusy())
        throw Error("MCP state changed during connector removal.");
    },
    clearConnector: (id) => service.clearConnector(id),
    shutdown: async () => {
      closed = true;
      service.shutdown();
      const vaultDrain = vault.shutdown();
      await Promise.allSettled(
        [
          pending,
          vaultDrain,
          vault.queue,
          vault.tail,
          service.queue,
          service.tail,
        ].filter(Boolean),
      );
    },
  };
}
