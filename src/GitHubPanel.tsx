import { useEffect, useMemo, useRef, useState } from "react";
type Configuration = {
  owner: string;
  repo: string;
  ref: string;
  useToken: boolean;
};
type Provenance = {
  host: string;
  apiVersion: string;
  repository: string;
  observedAt: string;
  requestId: string | null;
};
type ReadResult = {
  status: string;
  error?: string;
  notice?: string;
  repository?: {
    fullName: string;
    description: string;
    private: boolean;
    defaultBranch: string;
    archived: boolean;
  };
  treeId?: string;
  treeSha?: string;
  entries?: { path: string; sha: string; size: number }[];
  truncated?: boolean;
  file?: {
    path: string;
    sha: string;
    treeSha: string;
    content: string;
    untrusted: boolean;
  };
  provenance?: Provenance;
};
type Status = {
  configuration: Configuration;
  credential: { configured: boolean; secureStorageAvailable: boolean };
  busy: boolean;
  lastRead: Record<string, unknown> | null;
};
export interface GitHubAPI {
  githubStatus(): Promise<Status>;
  saveGithubConfig(input: Configuration): Promise<unknown>;
  saveGithubToken(input: { token: string }): Promise<{ saved: boolean }>;
  removeGithubToken(): Promise<{ removed: boolean }>;
  readGithubMetadata(): Promise<ReadResult>;
  readGithubTree(): Promise<ReadResult>;
  readGithubFile(input: { treeId: string; path: string }): Promise<ReadResult>;
  cancelGithubRead(): Promise<{ cancelled: boolean }>;
}
export function GitHubPanel({ report }: { report: (message: string) => void }) {
  const api = useMemo(() => {
      const value = window.sebby as unknown as GitHubAPI | undefined;
      return typeof value?.githubStatus === "function" ? value : null;
    }, []),
    [status, setStatus] = useState<Status | null>(null),
    [form, setForm] = useState<Configuration>({
      owner: "",
      repo: "",
      ref: "HEAD",
      useToken: false,
    }),
    [busy, setBusy] = useState<"settings" | "read" | null>(null),
    [notice, setNotice] = useState(""),
    [metadata, setMetadata] = useState<ReadResult | null>(null),
    [tree, setTree] = useState<ReadResult | null>(null),
    [file, setFile] = useState<ReadResult | null>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!api) return;
    let active = true;
    void api
      .githubStatus()
      .then((value) => {
        if (active) {
          setStatus(value);
          setForm(value.configuration);
        }
      })
      .catch(() => {
        if (active) report("GitHub settings could not be loaded.");
      });
    return () => {
      active = false;
      if (tokenInput.current) tokenInput.current.value = "";
    };
  }, [api, report]);
  async function refresh() {
    if (api) setStatus(await api.githubStatus());
  }
  async function read(kind: "metadata" | "tree" | "file", path?: string) {
    if (!api) return;
    setBusy("read");
    setNotice("");
    try {
      const result =
        kind === "metadata"
          ? await api.readGithubMetadata()
          : kind === "tree"
            ? await api.readGithubTree()
            : await api.readGithubFile({ treeId: tree!.treeId!, path: path! });
      if (result.status !== "ok") {
        setNotice(
          result.error || `Read ${result.status}. No new content loaded.`,
        );
        return;
      }
      if (kind === "metadata") setMetadata(result);
      else if (kind === "tree") {
        setTree(result);
        setFile(null);
      } else setFile(result);
      setNotice(
        "Read finished. Content is untrusted and has not been sent to AI.",
      );
      await refresh();
    } catch {
      report(
        "GitHub read could not complete. No automatic retry was attempted.",
      );
    } finally {
      setBusy(null);
    }
  }
  if (!api)
    return (
      <p className="muted">
        Read-only GitHub access is available in the desktop app. This browser
        preview accepts no GitHub token.
      </p>
    );
  if (!status) return <p role="status">Loading local GitHub settings…</p>;
  const disabled = !!busy || status.busy,
    configured = !!status.configuration.owner && !!status.configuration.repo;
  return (
    <section aria-label="Read-only GitHub">
      <h3>GitHub, read-only</h3>
      <p className="muted">
        Inspect one repository’s metadata, bounded tree, and selected UTF-8 text
        files. No clone, write, push, issue mutation, or automatic AI
        attachment.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy("settings");
          try {
            await api.saveGithubConfig(form);
            setTree(null);
            setFile(null);
            setMetadata(null);
            await refresh();
            setNotice(
              "Repository settings saved locally. No network request was made.",
            );
          } catch {
            report(
              "Repository settings could not be saved. Use owner/repository names and a valid ref, not URLs or credentials.",
            );
          } finally {
            setBusy(null);
          }
        }}
      >
        <fieldset disabled={disabled}>
          <legend>Repository selection</legend>
          <div className="form-grid">
            <label>
              Owner
              <input
                aria-label="GitHub owner"
                value={form.owner}
                maxLength={39}
                autoComplete="off"
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
              />
            </label>
            <label>
              Repository
              <input
                aria-label="GitHub repository"
                value={form.repo}
                maxLength={100}
                autoComplete="off"
                onChange={(e) => setForm({ ...form, repo: e.target.value })}
              />
            </label>
          </div>
          <label className="field-label" htmlFor="github-ref">
            Branch, tag, or tree SHA
          </label>
          <input
            id="github-ref"
            value={form.ref}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setForm({ ...form, ref: e.target.value })}
          />
          <label className="check spaced">
            <input
              type="checkbox"
              checked={form.useToken}
              onChange={(e) => setForm({ ...form, useToken: e.target.checked })}
            />
            Use the stored GitHub token for this repository
          </label>
          <p className="muted">
            Off by default: public repositories can be read without a token. No
            environment variable is read automatically.
          </p>
          <button className="primary" type="submit">
            Save repository settings
          </button>
        </fieldset>
      </form>
      <h4>Optional GitHub token</h4>
      <p className="muted">
        For private repositories, use a fine-grained token restricted to the
        intended repository with Contents: read and required Metadata: read.
        This app does not verify or reduce the token’s permissions. No OAuth
        client or secret is created.
      </p>
      <p>
        {status.credential.configured
          ? "OS-encrypted token available · access not verified"
          : "No usable stored GitHub token"}
      </p>
      {!status.credential.secureStorageAvailable && (
        <p className="banner">
          OS-protected storage unavailable. Token saving is disabled; no
          plaintext fallback.
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const input = tokenInput.current;
          if (!input) return;
          let token = input.value;
          if (token.length < 20 || token.length > 1024) {
            input.value = "";
            token = "";
            report("Enter a token in the masked field. The input was cleared.");
            return;
          }
          setBusy("settings");
          try {
            const promise = api.saveGithubToken({ token });
            input.value = "";
            token = "";
            const result = await promise;
            setTree(null);
            setFile(null);
            setMetadata(null);
            await refresh();
            setNotice(
              result.saved
                ? "GitHub token saved with OS encryption. No network request was made."
                : "Token save cancelled. The field was cleared.",
            );
          } catch {
            report(
              "GitHub token was not saved. Check secure storage and finish any active read. The field was cleared.",
            );
          } finally {
            input.value = "";
            token = "";
            setBusy(null);
          }
        }}
      >
        <label className="field-label" htmlFor="github-token">
          GitHub token (masked)
        </label>
        <input
          id="github-token"
          className="provider-input"
          type="password"
          ref={tokenInput}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={1024}
          disabled={disabled || !status.credential.secureStorageAvailable}
        />
        <div className="button-row spaced">
          <button
            className="secondary"
            type="submit"
            disabled={disabled || !status.credential.secureStorageAvailable}
          >
            Store GitHub token…
          </button>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={async () => {
              if (tokenInput.current) tokenInput.current.value = "";
              setBusy("settings");
              try {
                const result = await api.removeGithubToken();
                setTree(null);
                setFile(null);
                setMetadata(null);
                await refresh();
                setNotice(
                  result.removed
                    ? "Token removed locally. This does not revoke it on GitHub."
                    : "Token removal cancelled.",
                );
              } catch {
                report("Stored GitHub token could not be removed.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Remove stored GitHub token…
          </button>
        </div>
      </form>
      <h4 className="spaced">Explicit reads</h4>
      <p>
        Saved repository:{" "}
        <strong>
          {configured
            ? `${status.configuration.owner}/${status.configuration.repo}`
            : "not selected"}
        </strong>{" "}
        · ref <code>{status.configuration.ref}</code> ·{" "}
        {status.configuration.useToken
          ? "token enabled"
          : "public / unauthenticated"}
      </p>
      <p className="muted">
        Save edits first. Each button opens its own native network confirmation.
        GitHub receives your IP and, only when enabled, your stored token. Reads
        are not retried automatically.
      </p>
      <div className="button-row">
        <button
          className="secondary"
          disabled={disabled || !configured}
          onClick={() => void read("metadata")}
        >
          Review metadata read…
        </button>
        <button
          className="secondary"
          disabled={disabled || !configured}
          onClick={() => void read("tree")}
        >
          Review tree read…
        </button>
        {(busy === "read" || status.busy) && (
          <button
            className="secondary"
            onClick={async () => {
              try {
                await api.cancelGithubRead();
                setNotice("Read cancellation requested.");
              } catch {
                report("Could not request read cancellation.");
              }
            }}
          >
            Cancel GitHub read
          </button>
        )}
      </div>
      <p role="status" className="muted">
        {notice}
      </p>
      {metadata?.repository && (
        <article className="callout">
          <h4>{metadata.repository.fullName}</h4>
          <p>{metadata.repository.description}</p>
          <p>
            {metadata.repository.private ? "Private" : "Public"} · default
            branch {metadata.repository.defaultBranch}
            {metadata.repository.archived ? " · archived" : ""}
          </p>
          <small>
            Observed {metadata.provenance?.observedAt} · request{" "}
            {metadata.provenance?.requestId || "not reported"}
          </small>
        </article>
      )}
      {tree?.entries && (
        <>
          <h4>Supported text files</h4>
          <p className="muted">
            Tree {tree.treeSha}.{" "}
            {tree.truncated
              ? "Filtered or truncated subset—not a complete repository inventory."
              : "Within configured read limits."}{" "}
            Maximum 300 files; 256 KiB per file.
          </p>
          <div className="file-list">
            {tree.entries.length ? (
              tree.entries.map((entry) => (
                <button
                  key={entry.path}
                  disabled={disabled}
                  onClick={() => void read("file", entry.path)}
                >
                  {entry.path} · {entry.size} bytes
                </button>
              ))
            ) : (
              <p>No supported text files in this bounded result.</p>
            )}
          </div>
        </>
      )}
      {file?.file && (
        <article className="callout">
          <h4>{file.file.path}</h4>
          <p className="muted">
            Untrusted repository content · displayed only · not sent to AI. Blob{" "}
            {file.file.sha}
          </p>
          <pre className="change-diff">{file.file.content}</pre>
          <small>
            Observed {file.provenance?.observedAt} · request{" "}
            {file.provenance?.requestId || "not reported"}
          </small>
        </article>
      )}
    </section>
  );
}
