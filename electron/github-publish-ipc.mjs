import { GitHubAuthority } from "./github-authority.mjs";
import { GitHubHistory } from "./github-history.mjs";
import { GitHubPublisher } from "./github-publish.mjs";
/** Publication is separate from read-only access and never restores authority from backups. */
export async function installGitHubPublishing({
  directory,
  workspace,
  github,
  register,
  confirm,
  publisherOptions = {},
}) {
  let closed = false,
    pending = null;
  const permissions = new GitHubAuthority(directory, {
    approve: async (request) => {
      if (closed) return false;
      const granted = await confirm(
        request.action === "grant-github-publication"
          ? "Allow reviewed publication to this exact repository?"
          : "Revoke publication authority for this repository?",
        `${request.owner}/${request.repo}\n\nOnly new sebby/* branches with reviewed text-file commits and separately approved draft pull requests. No existing-branch updates, force pushes, merges, deletion or workflow dispatch. This permission alone never publishes; every write workflow still requires native approval. Your own GitHub token must have the necessary scoped access. Publishing can expose source and trigger existing CI with costs. Authority is stored locally and excluded from backups.`,
      );
      return granted === true && !closed;
    },
  });
  await permissions.load();
  const history = new GitHubHistory(directory);
  await history.load();
  const publisher = new GitHubPublisher({
    workspace,
    config: github.config,
    vault: github.vault,
    permissions,
    history,
    ...publisherOptions,
    approveRead: (request) =>
      confirm(
        "Allow bounded GitHub reads for this publication workflow?",
        `${JSON.stringify(request, null, 2)}\n\nLocal source is not sent by read-only preparation. No model receives repository content.`,
      ),
    approvePublish: (request) =>
      confirm(
        "Publish the exact reviewed files to a NEW GitHub branch?",
        `${request.owner}/${request.repo}\nBase: ${request.baseBranch} @ ${request.baseSHA}\nNew branch: ${request.branch}\nCommit message: ${request.message}\nFiles: ${(request.files || []).map((f) => `${f.path} (${f.sha256})`).join("\n")}\nPreview digest: ${request.digest}\n\nReview the full immutable diff in Sebby before confirming. Source leaves this device. Treat repository content as potentially PUBLIC unless you verified visibility. Existing CI may run and incur charges. Creates Git objects and a new branch only; no existing branch update, force, merge or rollback. Partial network failure can leave remote objects or an uncertain result; do not blindly retry.`,
      ),
    approvePR: (request) =>
      confirm(
        "Create this reviewed DRAFT pull request?",
        `${JSON.stringify(request, null, 2)}\n\nThis publishes the title/body, may notify collaborators and trigger CI. Draft only; no merge. No automatic retry on uncertain results.`,
      ),
  });
  const busy = () => !!pending || publisher.isBusy;
  const exclusive = (operation) => (input) => {
    if (closed) throw Error("GitHub publication is closing.");
    if (busy() || github.isBusy())
      throw Error("Finish or cancel the active GitHub operation.");
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
  const repository = () => {
    const { owner, repo } = github.config.get();
    if (!owner || !repo) throw Error("Save an exact GitHub repository first.");
    return { owner, repo };
  };
  register("publisher-status", () => {
    const config = github.config.get(),
      repo = { owner: config.owner, repo: config.repo };
    return {
      publisher: { ...publisher.status(), busy: busy() },
      authority: {
        repository: repo,
        allowed: !!(repo.owner && repo.repo && permissions.isAllowed(repo)),
      },
      history: history.list(),
    };
  });
  register(
    "grant-github-writes",
    exclusive(() => permissions.grant(repository())),
  );
  register(
    "revoke-github-writes",
    exclusive(async () => {
      const result = await permissions.revoke(repository());
      publisher.clearCache();
      return result;
    }),
  );
  register(
    "prepare-github-publication",
    exclusive((input) => publisher.prepare(input)),
  );
  register(
    "publish-github-publication",
    exclusive((input) => publisher.publish(input)),
  );
  register(
    "discard-github-publication",
    exclusive((input) => publisher.discard(input)),
  );
  register("cancel-github-publication", () => publisher.cancel());
  register(
    "create-github-draft-pr",
    exclusive((input) => publisher.createDraftPR(input)),
  );
  register(
    "check-github-builds",
    exclusive((input) => publisher.checks(input)),
  );
  return {
    permissions,
    history,
    publisher,
    isBusy: busy,
    clearCache: () => publisher.clearCache(),
    shutdown: async () => {
      closed = true;
      publisher.shutdown();
      await Promise.allSettled([pending, permissions.tail, history.tail]);
    },
  };
}
