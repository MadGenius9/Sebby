import { useRef, useState } from "react";
type Publication = {
  id: string;
  owner: string;
  repo: string;
  newBranch: string;
  commitSHA: string | null;
  phase: string;
  outcome: string;
  prNumber?: number | null;
};
type Proposal = {
  id: string;
  digest: string;
  truncated: false;
  owner: string;
  repo: string;
  baseBranch: string;
  baseSHA: string;
  branch: string;
  message: string;
  files: {
    path: string;
    before: string;
    after: string;
    sha256: string;
    diff: string;
  }[];
};
type Status = {
  publisher: {
    busy: boolean;
    operation?: string;
    lastOutcome?: unknown;
    proposalIds?: string[];
  };
  authority: { repository: { owner: string; repo: string }; allowed: boolean };
  history: Publication[];
};
type Outcome = {
  status: string;
  message?: string;
  proposal?: Proposal;
  publication?: Publication;
  commitSHA?: string;
  checks?: { name: string; status: string; conclusion: string | null }[];
  truncated?: boolean;
  observedAt?: string;
};
type API = {
  publisherStatus(): Promise<Status>;
  grantGithubWrites(): Promise<unknown>;
  revokeGithubWrites(): Promise<unknown>;
  prepareGithubPublication(input: {
    paths: string[];
    baseBranch: string;
    branch: string;
    message: string;
  }): Promise<Outcome>;
  publishGithubPublication(input: {
    proposalId: string;
    digest: string;
  }): Promise<Outcome>;
  discardGithubPublication(input: { proposalId: string }): Promise<unknown>;
  cancelGithubPublication(): Promise<unknown>;
  createGithubDraftPR(input: {
    publicationId: string;
    title: string;
    body: string;
  }): Promise<Outcome>;
  checkGithubBuilds(input: { publicationId: string }): Promise<Outcome>;
};
function validProposal(value: unknown): value is Proposal {
  if (!value || typeof value !== "object") return false;
  const p = value as Proposal;
  return (
    typeof p.id === "string" &&
    /^[a-f0-9]{64}$/i.test(p.digest) &&
    p.truncated === false &&
    typeof p.owner === "string" &&
    typeof p.repo === "string" &&
    typeof p.branch === "string" &&
    typeof p.baseBranch === "string" &&
    typeof p.baseSHA === "string" &&
    typeof p.message === "string" &&
    Array.isArray(p.files) &&
    p.files.length > 0 &&
    p.files.length <= 10 &&
    p.files.every(
      (f) =>
        typeof f.path === "string" &&
        typeof f.before === "string" &&
        typeof f.after === "string" &&
        typeof f.sha256 === "string" &&
        typeof f.diff === "string" &&
        f.diff.length <= 300000,
    ) &&
    p.files.reduce((n, f) => n + f.before.length + f.after.length, 0) <= 524288
  );
}
export function GitHubPublishPanel({
  report,
}: {
  report: (message: string) => void;
}) {
  const candidate = (window as unknown as { sebby?: Partial<API> }).sebby;
  const api =
    typeof candidate?.publisherStatus === "function"
      ? (candidate as API)
      : undefined;
  const [status, setStatus] = useState<Status | null>(null),
    [paths, setPaths] = useState(""),
    [baseBranch, setBase] = useState(""),
    [branch, setBranch] = useState("sebby/"),
    [message, setMessage] = useState(""),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState(""),
    [selected, setSelected] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [prAck, setPrAck] = useState(false),
    [checks, setChecks] = useState<Outcome | null>(null);
  const lock = useRef(false);
  const list = paths
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const validPaths =
    list.length > 0 &&
    list.length <= 10 &&
    new Set(list).size === list.length &&
    list.every(
      (p) =>
        p.length <= 240 &&
        !/[:\\\x00-\x1f\x7f?#]/.test(p) &&
        !p.startsWith("/") &&
        p.split("/").every((s) => s && s !== "." && s !== ".."),
    );
  const publication = status?.history.find((p) => p.id === selected);
  const verified =
    publication?.owner === status?.authority.repository.owner &&
    publication?.repo === status?.authority.repository.repo &&
    !!publication?.commitSHA &&
    ["branch-created", "published"].includes(publication.outcome);
  async function refresh() {
    const result = await api!.publisherStatus();
    if (
      !result ||
      !result.publisher ||
      !result.authority?.repository ||
      !Array.isArray(result.history)
    )
      throw Error("schema");
    setStatus(result);
    return result;
  }
  async function run(action: () => Promise<unknown>) {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      setOutcome(
        "Action failed or its result could not be confirmed. Refresh local history; do not blindly retry a publication.",
      );
      report("GitHub publication action could not be confirmed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function show(result: Outcome) {
    setOutcome(
      `${result.status}${result.message ? `: ${result.message}` : ""}`,
    );
  }
  const blocked = !api || busy || !!status?.publisher.busy;
  return (
    <section aria-label="Reviewed GitHub publication">
      <h3>Reviewed GitHub publication</h3>
      <p>
        Publish only selected workspace text files to a new sebby/* branch in
        the exact configured repository. Native approval is required. No
        existing branch overwrite, force push, merge or deletion. No automatic
        retry.
      </p>
      {!api && <p>Publishing requires the desktop app.</p>}
      <button disabled={!api || busy} onClick={() => void run(refresh)}>
        Refresh publication status
      </button>
      <p>
        Repository:{" "}
        {status
          ? `${status.authority.repository.owner}/${status.authority.repository.repo}`
          : "Not checked"}
        . Write authority:{" "}
        {status
          ? status.authority.allowed
            ? "Granted for this repository"
            : "Not granted"
          : "Not checked"}
        .
      </p>
      <button
        disabled={blocked || !status || status.authority.allowed}
        onClick={() =>
          void run(async () => {
            await api!.grantGithubWrites();
            await refresh();
          })
        }
      >
        Grant writes with native approval
      </button>
      <button
        disabled={blocked || !status?.authority.allowed}
        onClick={() =>
          void run(async () => {
            await api!.revokeGithubWrites();
            setProposal(null);
            setAck(false);
            await refresh();
          })
        }
      >
        Revoke repository write authority
      </button>
      <label>
        Workspace text paths (one per line, at most 10)
        <textarea
          aria-label="Workspace text paths"
          value={paths}
          disabled={busy}
          onChange={(e) => setPaths(e.target.value)}
        />
      </label>
      <label>
        Base branch
        <input
          value={baseBranch}
          onChange={(e) => setBase(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        New sebby branch
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        Commit message
        <input
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
        />
      </label>
      <button
        disabled={
          blocked ||
          !status?.authority.allowed ||
          !validPaths ||
          !baseBranch.trim() ||
          !branch.startsWith("sebby/") ||
          branch.length <= 6 ||
          !message.trim()
        }
        onClick={() =>
          void run(async () => {
            setProposal(null);
            setAck(false);
            const r = await api!.prepareGithubPublication({
              paths: list,
              baseBranch,
              branch,
              message,
            });
            show(r);
            if (r.status === "ready" && validProposal(r.proposal))
              setProposal(r.proposal);
            else if (r.status === "ready")
              setOutcome(
                "Proposal is incomplete or truncated. Publishing is disabled.",
              );
            await refresh();
          })
        }
      >
        Prepare full diff for review
      </button>
      {proposal && (
        <article>
          <h4>Immutable publication proposal</h4>
          <p>
            {proposal.owner}/{proposal.repo}: {proposal.baseBranch} at{" "}
            {proposal.baseSHA} → {proposal.branch}
          </p>
          <p>Commit: {proposal.message}</p>
          <p>
            Proposal: {proposal.id} · Digest: <code>{proposal.digest}</code>
          </p>
          {proposal.files.map((f) => (
            <div key={f.path}>
              <h5>{f.path}</h5>
              <p>SHA-256: {f.sha256}</p>
              <pre>{f.diff}</pre>
              <details>
                <summary>Complete before and after text</summary>
                <h6>Before</h6>
                <pre>{f.before}</pre>
                <h6>After</h6>
                <pre>{f.after}</pre>
              </details>
            </div>
          ))}
          <label>
            <input
              type="checkbox"
              checked={ack}
              disabled={blocked}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed this full diff and exact repository, base commit and new
            branch.
          </label>
          <button
            disabled={
              blocked ||
              !ack ||
              !status?.authority.allowed ||
              proposal.owner !== status.authority.repository.owner ||
              proposal.repo !== status.authority.repository.repo
            }
            onClick={() =>
              void run(async () => {
                const r = await api!.publishGithubPublication({
                  proposalId: proposal.id,
                  digest: proposal.digest,
                });
                show(r);
                setProposal(null);
                setAck(false);
                await refresh();
                if (r.publication) setSelected(r.publication.id);
              })
            }
          >
            Publish reviewed proposal with native approval
          </button>
          <button
            disabled={blocked}
            onClick={() =>
              void run(async () => {
                await api!.discardGithubPublication({
                  proposalId: proposal.id,
                });
                setProposal(null);
                setAck(false);
                await refresh();
              })
            }
          >
            Discard proposal
          </button>
        </article>
      )}
      <button
        disabled={!api || (!busy && !status?.publisher.busy)}
        onClick={() => {
          void api!
            .cancelGithubPublication()
            .then(() =>
              setOutcome(
                "Cancellation requested. A dispatched write may still have taken effect; refresh history before taking further action.",
              ),
            )
            .catch(() => report("Cancellation could not be confirmed."));
        }}
      >
        Cancel current publication operation
      </button>
      <p role="status">{outcome || "No publication requested."}</p>
      <p>
        Cancellation or uncertain results do not prove that GitHub was
        unchanged. Check the recorded stage and exact repository before
        retrying.
      </p>
      <h4>Local metadata history</h4>
      <select
        aria-label="Publication history"
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          setChecks(null);
          setPrAck(false);
        }}
      >
        <option value="">Select a publication</option>
        {status?.history.map((p) => (
          <option key={p.id} value={p.id}>
            {p.owner}/{p.repo} · {p.newBranch} · {p.phase} / {p.outcome}
          </option>
        ))}
      </select>
      {publication && (
        <p>
          Stage: {publication.phase}. Outcome: {publication.outcome}. Commit:{" "}
          {publication.commitSHA || "Not verified"}
          {publication.prNumber ? ` · Draft PR #${publication.prNumber}` : ""}
        </p>
      )}
      <label>
        Draft pull request title
        <input
          value={title}
          maxLength={250}
          onChange={(e) => {
            setTitle(e.target.value);
            setPrAck(false);
          }}
        />
      </label>
      <label>
        Draft pull request body
        <textarea
          value={body}
          maxLength={10000}
          onChange={(e) => {
            setBody(e.target.value);
            setPrAck(false);
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={prAck}
          onChange={(e) => setPrAck(e.target.checked)}
        />
        I reviewed this draft pull request title and body.
      </label>
      <button
        disabled={
          blocked ||
          !verified ||
          !status?.authority.allowed ||
          !!publication?.prNumber ||
          !prAck ||
          !title.trim()
        }
        onClick={() =>
          void run(async () => {
            show(
              await api!.createGithubDraftPR({
                publicationId: selected,
                title,
                body,
              }),
            );
            setPrAck(false);
            await refresh();
          })
        }
      >
        Create reviewed draft PR with native approval
      </button>
      <button
        disabled={blocked || !verified}
        onClick={() =>
          void run(async () => {
            const r = await api!.checkGithubBuilds({ publicationId: selected });
            show(r);
            setChecks(r);
          })
        }
      >
        Read check-run statuses
      </button>
      {checks?.status === "ok" && (
        <div>
          <p>
            Checks for {checks.commitSHA} observed {checks.observedAt}.{" "}
            {checks.truncated
              ? "Truncated results; not a complete check inventory."
              : ""}
          </p>
          {checks.checks?.map((c, i) => (
            <p key={i}>
              {c.name}: {c.status} / {c.conclusion || "No conclusion"}
            </p>
          ))}
          {!checks.checks?.length && (
            <p>
              No check runs reported. This is not proof of a successful build.
            </p>
          )}
        </div>
      )}
      <p>
        History stores metadata only. Files and diffs remain transient; no token
        or file content is saved by this panel.
      </p>
    </section>
  );
}
