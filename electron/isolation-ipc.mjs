import path from "node:path";
import { IsolationConfig, isolationStatus } from "./isolation-config.mjs";
import { WorkspaceSnapshot } from "./isolation-snapshot.mjs";
/** Production never receives a runner transport. This surface stages local copies only. */
export async function installIsolation({
  directory,
  workspace,
  register,
  confirm,
  isExternalBusy = () => false,
}) {
  let closed = false,
    pending = null;
  const retained = new Map();
  const approve = async (request) => {
    if (closed) return false;
    const result = await confirm(
      "Review local isolation preparation (execution unavailable)",
      `${JSON.stringify(request, null, 2)}\n\nNo engine, image, build, test or network request will run. Configuration is unverified. Selected file copies may contain private source; filename filters are not secret detection. No host project is modified. Native engine/recipe validation is required before any future execution.`,
    );
    return (
      result === true &&
      !closed &&
      (!request.workspaceRoot || workspace.root === request.workspaceRoot)
    );
  };
  const config = new IsolationConfig(directory, { approve });
  await config.load();
  const snapshots = new WorkspaceSnapshot({
    stagingRoot: path.join(directory, "sebby-isolation-staging"),
    approve,
  });
  const busy = () => !!pending || snapshots.busy;
  const exclusive = (fn) => (input) => {
    if (closed || busy() || isExternalBusy())
      throw Error("Finish active workspace work before isolation preparation.");
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
  const publicSnapshot = ({
    id,
    files,
    totalBytes,
    snapshotHash,
    lockSha256,
  }) => ({ id, files, totalBytes, snapshotHash, lockSha256 });
  register("isolation-status", () => ({
    ...config.get(),
    ...isolationStatus(),
    busy: busy(),
    snapshots: [...retained.values()],
  }));
  register(
    "save-isolation-config",
    exclusive((input) => config.save(input)),
  );
  register(
    "prepare-isolation-snapshot",
    exclusive(async (input) => {
      if (
        !input ||
        Object.keys(input).some((key) => key !== "paths") ||
        !Array.isArray(input.paths)
      )
        throw Error("Choose exact snapshot paths only.");
      if (!workspace.root) throw Error("Choose a workspace first.");
      if (retained.size >= 3)
        throw Error(
          "Discard an existing snapshot before preparing another (maximum three).",
        );
      const result = await snapshots.prepare(workspace.root, input.paths);
      if (closed) {
        await snapshots.dispose(result.id);
        throw Error("Isolation preparation is closing.");
      }
      const safe = publicSnapshot(result);
      retained.set(result.id, safe);
      return safe;
    }),
  );
  register(
    "verify-isolation-snapshot",
    exclusive(async (id) => {
      if (!retained.has(id)) throw Error("Unknown session snapshot.");
      await snapshots.verify(id);
      return {
        verified: true,
        snapshot: retained.get(id),
        executionAvailable: false,
      };
    }),
  );
  register(
    "discard-isolation-snapshot",
    exclusive(async (id) => {
      if (!retained.has(id)) throw Error("Unknown session snapshot.");
      await snapshots.dispose(id);
      retained.delete(id);
      return { discarded: true };
    }),
  );
  return {
    config,
    snapshots,
    isBusy: busy,
    shutdown: async () => {
      closed = true;
      await Promise.allSettled(
        [pending, config.queue, config.tail].filter(Boolean),
      );
      await snapshots.shutdown();
      retained.clear();
    },
  };
}
