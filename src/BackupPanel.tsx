import { useState } from "react";
import { Download, Upload, ShieldCheck } from "lucide-react";
import { backups, type BackupPreview } from "./bridge";
export function BackupPanel({ report }: { report: (s: string) => void }) {
  const [preview, setPreview] = useState<BackupPreview | null>(null),
    [notice, setNotice] = useState("");
  return (
    <div className="callout">
      <h3>Your data, in your hands.</h3>
      <p>
        Export local memory, drafts, tasks, reminders, skills, and connector
        bookmarks. Backups are plaintext and can contain sensitive context. They
        do not include project files, credentials, or edit-backup originals.
      </p>
      {!backups ? (
        <p className="muted">
          Backup and restore are available in the desktop app.
        </p>
      ) : (
        <>
          <div className="button-row">
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const result = await backups!.exportBackup();
                  setNotice(
                    result.exported
                      ? "Local backup exported."
                      : "Export cancelled.",
                  );
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              <Download size={16} />
              Export backup…
            </button>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  setPreview(await backups!.previewBackupImport());
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              <Upload size={16} />
              Preview restore…
            </button>
          </div>
          {preview && (
            <div className="spaced">
              <h3>Restore preview</h3>
              <ul>
                {preview.summary.map((item) => (
                  <li key={item.name}>
                    {item.name} · {Math.ceil(item.bytes / 1024)} KiB
                  </li>
                ))}
              </ul>
              {preview.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <button
                className="primary"
                onClick={async () => {
                  try {
                    const result = await backups!.restoreBackup(preview.token);
                    setNotice(
                      result.restored
                        ? "Restored. Sebby is restarting."
                        : "Restore cancelled.",
                    );
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                <ShieldCheck size={16} />
                Approve restore and restart…
              </button>
            </div>
          )}
          <p role="status">{notice}</p>
        </>
      )}
    </div>
  );
}
