import { useEffect, useRef, useState } from "react";

type Proposal = {
  id: string;
  source: { path: string; sha256: string; bytes: number };
  observations: {
    elements: Record<string, number>;
    headings: { tag: string; line: number | null }[];
    scripts: number;
    resourceReferences: number;
  };
  blueprint: {
    name: string;
    recipe: string;
    sectionCount: number;
    explanation: string;
  };
  limitations: string[];
};
type Artifact = {
  id: string;
  directory: string;
  path: string;
  sha256: string;
  tests: { name: string; passed: boolean }[];
  reportPath?: string;
};
type Api = {
  prepareEvidence(input: {
    path: string;
    authorized: boolean;
  }): Promise<{ status: string; proposal?: Proposal }>;
  buildEvidence(input: {
    proposalId: string;
  }): Promise<{ status: string; artifact?: Artifact }>;
  previewEvidence(input: { buildId: string }): Promise<{ status: string }>;
};

export function EvidenceWorkflowPanel({
  report,
}: {
  report: (message: string) => void;
}) {
  const candidate = window.sebby as unknown as Partial<Api> | undefined;
  const api =
    candidate?.prepareEvidence &&
    candidate?.buildEvidence &&
    candidate?.previewEvidence
      ? (candidate as Api)
      : null;
  const [path, setPath] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [artifact, setArtifact] = useState<Artifact | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const active = useRef(true),
    working = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const valid =
    path.length > 0 &&
    path.length <= 240 &&
    !/[\\:\x00-\x1f\x7f?#]/.test(path) &&
    path
      .split("/")
      .every((p) => p && p !== "." && p !== ".." && !p.startsWith(".")) &&
    /\.html?$/i.test(path);
  async function run(kind: "prepare" | "build" | "preview") {
    if (!api || working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    try {
      if (kind === "prepare") {
        setProposal(null);
        setArtifact(null);
        const result = await api.prepareEvidence({ path, authorized });
        if (!active.current) return;
        setProposal(result.proposal || null);
        setNotice(
          result.status === "prepared"
            ? "Evidence prepared. Review observations, blueprint and limitations before building."
            : "Inspection was not approved. No build created.",
        );
      } else if (kind === "build" && proposal) {
        setArtifact(null);
        const result = await api.buildEvidence({ proposalId: proposal.id });
        if (!active.current) return;
        setArtifact(result.artifact || null);
        setNotice(
          result.status === "built"
            ? "Original static prototype saved and structural checks passed. No target code executed."
            : "Build was not approved. No prototype created.",
        );
      } else if (kind === "preview" && artifact) {
        const result = await api.previewEvidence({ buildId: artifact.id });
        if (!active.current) return;
        setNotice(
          result.status === "previewed"
            ? "Static prototype opened in a restricted preview window."
            : "Preview did not open. The saved build remains available.",
        );
      }
    } catch (error) {
      if (active.current) {
        const message = (error as Error).message || "Evidence action failed.";
        setNotice(message);
        report(message);
      }
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Authorized static rebuild">
      <h3>Inspect, explain, and build an original static study</h3>
      <p>
        Choose one local HTML file you own or are authorized to analyze. Sebby
        observes markup structure without running its scripts or opening URLs,
        then offers an original fixed-template prototype in a separate scratch
        folder.
      </p>
      <p className="muted">
        Static subset only: no live website, binary, application logic, REA
        execution, or arbitrary package build. No source text, assets or
        branding are copied. Native approval is required for inspection, build
        and preview.
      </p>
      <label className="field-label">
        Authorized local HTML path
        <input
          aria-label="Authorized local HTML path"
          value={path}
          maxLength={240}
          disabled={busy}
          placeholder="example.html"
          onChange={(e) => {
            setPath(e.target.value);
            setProposal(null);
            setArtifact(null);
            setAuthorized(false);
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={authorized}
          disabled={busy}
          onChange={(e) => {
            setAuthorized(e.target.checked);
            setProposal(null);
            setArtifact(null);
          }}
        />
        I own this target or have permission to analyze it
      </label>
      <button
        disabled={!api || busy || !valid || !authorized}
        onClick={() => void run("prepare")}
      >
        Inspect authorized HTML
      </button>
      {!api && <p>Evidence inspection and build require the desktop app.</p>}
      {proposal && (
        <div className="callout">
          <h4>Observed evidence</h4>
          <p>
            File: {proposal.source.path} · {proposal.source.bytes} bytes
          </p>
          <p>
            Source SHA-256: <code>{proposal.source.sha256}</code>
          </p>
          <p>
            {proposal.observations.headings.length} observed headings;{" "}
            {proposal.observations.scripts} script elements were not executed;{" "}
            {proposal.observations.resourceReferences} resource references were
            not fetched.
          </p>
          <details>
            <summary>Review structural observations</summary>
            <pre className="file-preview">
              {JSON.stringify(proposal.observations, null, 2)}
            </pre>
          </details>
          <h4>Explained blueprint</h4>
          <p>{proposal.blueprint.explanation}</p>
          <p>
            {proposal.blueprint.sectionCount} original sections ·{" "}
            {proposal.blueprint.recipe}
          </p>
          <ul>
            {proposal.limitations.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <button disabled={busy} onClick={() => void run("build")}>
            Review and build static prototype
          </button>
        </div>
      )}
      {artifact && (
        <div className="callout">
          <h4>Built artifact and actual checks</h4>
          <p>
            Saved outside the selected workspace: {artifact.directory}/
            {artifact.path}
          </p>
          {artifact.reportPath && (
            <p>
              A local evidence report is saved alongside as{" "}
              {artifact.reportPath}. Import that JSON into Knowledge if you want
              a searchable saved reference; it is not added automatically.
            </p>
          )}
          <p>
            SHA-256: <code>{artifact.sha256}</code>
          </p>
          <ul>
            {artifact.tests.map((test) => (
              <li key={test.name}>
                {test.passed ? "PASS" : "FAIL"}: {test.name}
              </li>
            ))}
          </ul>
          <p>
            These are static structure checks, not an application build/test or
            isolation certification.
          </p>
          <button
            disabled={busy || artifact.tests.some((test) => !test.passed)}
            onClick={() => void run("preview")}
          >
            Preview original static prototype
          </button>
        </div>
      )}
      <p role="status">
        {busy ? "Waiting for the requested evidence action…" : notice}
      </p>
    </section>
  );
}
