import { useEffect, useRef, useState } from "react";
import { changeReviews, type PendingChange } from "./bridge";
export function ChangeReviewDialog() {
  const [pending, setPending] = useState<PendingChange | null>(null),
    [error, setError] = useState(""),
    [checked, setChecked] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!changeReviews?.pendingChangeReview) return;
    let live = true;
    const refresh = () =>
      changeReviews!
        .pendingChangeReview()
        .then((value) => {
          if (live)
            setPending((current) => {
              if (current?.id !== value?.id) setChecked(false);
              return value;
            });
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
    if (!pending && dialog.current?.open) dialog.current.close();
  }, [pending?.id]);
  async function respond(accepted: boolean) {
    if (!pending) return;
    try {
      await changeReviews!.respondChangeReview({ id: pending.id, accepted });
      setPending(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="change-dialog"
      onCancel={(event) => {
        event.preventDefault();
        void respond(false);
      }}
      aria-labelledby="change-title"
    >
      <h2 id="change-title">Review the exact file change</h2>
      {pending && (
        <>
          <p>
            <strong>{pending.path}</strong> · {pending.operation} ·{" "}
            {pending.kind === "undo-edit" ? "Undo request" : "Proposed change"}
          </p>
          <p className="muted">Folder: {pending.workspace}</p>
          <pre className="change-diff full-review">{pending.diff}</pre>
          <p className="muted">
            Whole-file preview: {pending.removedLines} removed /{" "}
            {pending.addedLines} added lines. No change is applied by this
            screen.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I have reviewed this exact change.
          </label>
          <div className="button-row">
            <button className="secondary" onClick={() => void respond(false)}>
              Reject change
            </button>
            <button
              className="primary"
              disabled={!checked}
              onClick={() => void respond(true)}
            >
              Continue to native confirmation…
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </dialog>
  );
}
