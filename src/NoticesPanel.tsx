import { useState } from "react";
export function NoticesPanel({
  report,
}: {
  report: (message: string) => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  const api = window.sebby as unknown as
    { thirdPartyNotices?: () => Promise<string> } | undefined;
  return (
    <section className="spaced">
      <h2>Open-source notices</h2>
      <p className="muted">
        Dependency notices are available locally. This is not commercial
        licensing or release clearance; native runtime notices and final
        distribution review remain required.
      </p>
      <button
        className="secondary"
        disabled={!api?.thirdPartyNotices || busy}
        onClick={async () => {
          setBusy(true);
          try {
            setText(await api!.thirdPartyNotices!());
          } catch {
            report(
              "Bundled notices could not be loaded. Read docs/THIRD-PARTY-NOTICES.md in the source.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Read bundled notices
      </button>
      {!api?.thirdPartyNotices && (
        <p className="muted">
          Available in the desktop app or source documentation.
        </p>
      )}
      {text && <pre className="file-preview">{text}</pre>}
    </section>
  );
}
