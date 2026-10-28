import { useEffect, useRef, useState } from "react";
type PreviewStatus = {
  status: "closed" | "opening" | "open" | "error";
  path?: string;
  hash?: string;
  error?: string;
};
type PreviewApi = {
  previewStatus(): Promise<PreviewStatus>;
  openPreview(input: { path: string }): Promise<unknown>;
  closePreview(): Promise<unknown>;
};
export function PreviewPanel({
  report,
}: {
  report: (message: string) => void;
}) {
  const candidate = (window as unknown as { sebby?: Partial<PreviewApi> })
    .sebby;
  const api =
    candidate?.previewStatus &&
    candidate?.openPreview &&
    candidate?.closePreview
      ? (candidate as PreviewApi)
      : undefined;
  const [path, setPath] = useState(""),
    [status, setStatus] = useState<PreviewStatus>({ status: "closed" }),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [checked, setChecked] = useState(false);
  const mounted = useRef(true),
    working = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const valid =
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/[:\x00-\x1f\x7f?#]/.test(path) &&
    path.split("/").every((p) => p && p !== "." && p !== "..") &&
    /\.html?$/i.test(path);
  async function action(kind: "open" | "close" | "refresh") {
    if (!api || working.current || (kind === "open" && !valid)) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    try {
      if (kind === "open") await api.openPreview({ path });
      if (kind === "close") await api.closePreview();
      const next = await api.previewStatus();
      if (mounted.current) {
        setStatus(next);
        setChecked(true);
        if (kind === "open" && next.status !== "open")
          setNotice(
            "Preview was not opened. Approval may have been declined; refresh to check its state.",
          );
      }
    } catch {
      if (mounted.current) {
        setNotice(
          "Preview action could not be completed. Refresh status before trying again.",
        );
        report("Preview action failed. No automatic retry.");
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Static HTML/CSS preview">
      <h3>Static HTML/CSS preview</h3>
      <p>
        Open a relative HTML file from the selected workspace in a separate
        restricted window. Native approval is required each time; nothing starts
        automatically.
      </p>
      <p>
        Single-file HTML and inline CSS only. JavaScript is disabled;
        interactivity, network access and external assets are not supported.
        Filesystem access, Node and preload APIs are blocked. This is a static
        visual preview, not evidence of a successful app build or test.
      </p>
      <label>
        Relative HTML path
        <input
          aria-label="Relative HTML path"
          placeholder="index.html"
          value={path}
          maxLength={240}
          disabled={busy}
          onChange={(e) => setPath(e.target.value)}
        />
      </label>
      {path && !valid && (
        <p>
          Enter a relative .html or .htm path without parent traversal, URL
          parameters or absolute paths.
        </p>
      )}
      <button
        disabled={!api || busy || !valid}
        onClick={() => void action("open")}
      >
        Open static preview
      </button>
      <button disabled={!api || busy} onClick={() => void action("close")}>
        Close preview
      </button>
      <button disabled={!api || busy} onClick={() => void action("refresh")}>
        Refresh preview status
      </button>
      {!api && <p>Preview requires the desktop app.</p>}
      <p role="status">
        {busy
          ? "Checking preview…"
          : checked
            ? `Preview: ${status.status}`
            : "Preview status not checked"}
      </p>
      {status.path && <p>File: {status.path}</p>}
      {status.hash && (
        <p>
          Content hash: <code>{status.hash}</code>
        </p>
      )}
      {status.status === "error" && (
        <p>Preview unavailable. Check the file and retry explicitly.</p>
      )}
      {notice && <p>{notice}</p>}
    </section>
  );
}
