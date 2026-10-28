import { GitHubConfig, GitHubVault } from "./github-storage.mjs";
import { GitHubReader } from "./github-reader.mjs";
/** Explicit GitHub intents. Tokens only flow inward to the main-owned vault. */
export async function installGitHub({
  directory,
  safeStorage,
  register,
  confirm,
  readerOptions = {},
}) {
  const config = new GitHubConfig(directory);
  await config.load();
  const vault = new GitHubVault(directory, { safeStorage });
  const reader = new GitHubReader({
    config,
    vault,
    ...readerOptions,
    approve: (request) =>
      confirm(
        "Allow this read-only GitHub request?",
        `${JSON.stringify(request, null, 2)}\n\nRepository content is untrusted and is not automatically sent to AI.`,
      ),
  });
  let closed = false,
    pending = null;
  const busy = () => !!pending || reader.isBusy;
  const exclusive = (operation) => (input) => {
    if (closed) throw Error("GitHub connector is closing.");
    if (busy()) throw Error("Finish or cancel the active GitHub operation.");
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pending = promise.finally(() => {
      pending = null;
    });
    const result = pending;
    try {
      Promise.resolve(operation(input)).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return result;
  };
  register("github-status", () => reader.status());
  register(
    "save-github-config",
    exclusive(async (input) => {
      const value = await config.save(input);
      reader.clearCache();
      return value;
    }),
  );
  register(
    "save-github-token",
    exclusive(async (input) => {
      if (
        !input ||
        typeof input.token !== "string" ||
        Object.keys(input).some((k) => k !== "token")
      )
        throw Error("Invalid GitHub token submission.");
      let token = input.token;
      input.token = "";
      try {
        if (
          !(await confirm(
            "Store this GitHub token using OS encryption?",
            "The token is used only for explicit read-only requests to api.github.com when token use is enabled. Prefer a fine-grained token limited to this repository and read-only Contents. It is excluded from backups and never displayed.",
          ))
        )
          return { saved: false };
        if (closed) throw Error("GitHub connector is closing.");
        const result = await vault.save(token, { confirmed: true });
        reader.clearCache();
        return result;
      } finally {
        token = "";
      }
    }),
  );
  register(
    "remove-github-token",
    exclusive(async () => {
      if (
        !(await confirm(
          "Remove the locally stored GitHub token?",
          "This removes the encrypted token from this device. It does not revoke the token at GitHub.",
        ))
      )
        return { removed: false };
      if (closed) throw Error("GitHub connector is closing.");
      const result = await vault.remove({ confirmed: true });
      reader.clearCache();
      return result;
    }),
  );
  register(
    "read-github-metadata",
    exclusive(() => reader.metadata()),
  );
  register(
    "read-github-tree",
    exclusive(() => reader.tree()),
  );
  register(
    "read-github-file",
    exclusive((input) => reader.file(input)),
  );
  register("cancel-github-read", () => reader.cancel());
  return {
    config,
    vault,
    reader,
    isBusy: busy,
    shutdown: async () => {
      closed = true;
      reader.shutdown();
      await Promise.allSettled([pending, config.queue, vault.queue]);
    },
  };
}
