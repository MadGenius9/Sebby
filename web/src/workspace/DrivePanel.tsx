import { useEffect, useState } from "react";
import { documentSchema } from "@shared/workspace/schema";
import { workspaceApi, type Project } from "./api";
type DriveStatus = {
  configured: boolean;
  connected: boolean;
  scope: string;
  pickerConfigured: boolean;
};
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};
let pickerLibrary: Promise<void> | null = null;
function loadPicker() {
  if (!pickerLibrary)
    pickerLibrary = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.onload = () => {
        (window as any).gapi.load("picker", {
          callback: resolve,
          onerror: () => reject(new Error("Google Picker could not load")),
          timeout: 10000,
          ontimeout: () => reject(new Error("Google Picker timed out")),
        });
      };
      script.onerror = () => {
        pickerLibrary = null;
        reject(new Error("Google Picker could not load"));
      };
      document.head.appendChild(script);
    });
  return pickerLibrary;
}
export function DrivePanel({
  project,
  dirty,
  update,
}: {
  project: Project | null;
  dirty: boolean;
  update: (p: Project) => void;
}) {
  const [status, setStatus] = useState<DriveStatus | null>(null),
    [files, setFiles] = useState<DriveFile[]>([]),
    [pageToken, setPageToken] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reference, setReference] = useState<{
    path: string;
    content: string;
    source: { name: string; fileId: string };
  } | null>(null);
  useEffect(() => {
    workspaceApi
      .driveStatus()
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const read = async (id: string) => {
    setReference(await workspaceApi.driveReference(id));
  };
  return (
    <section className="drive-panel">
      <h2>Google Drive</h2>
      {!status ? (
        <p>Checking connection…</p>
      ) : (
        <>
          <p>
            {status.connected
              ? "Connected with selected-file access."
              : "Not connected."}{" "}
            Sebby requests access to files you select or create with this app.
            Google sign-in for Sebby is a separate connection.
          </p>
          {!status.configured ? (
            <>
              <p>
                Server setup required: Google OAuth client, callback URL and
                connector encryption key. See the connection setup guide.
              </p>
              {status.connected && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await workspaceApi.driveDisconnect();
                      setStatus({ ...status, connected: false });
                      setNotice(
                        result.revoked
                          ? "Stored connection removed and Google authorization revoked."
                          : "Stored connection removed. Remove the remaining grant in Google account permissions.",
                      );
                    })
                  }
                >
                  Remove stored Drive connection
                </button>
              )}
            </>
          ) : !status.connected ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await workspaceApi.driveConnect();
                  location.assign(result.url);
                })
              }
            >
              Connect Google Drive
            </button>
          ) : (
            <>
              <div className="source-import-actions">
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={busy || !status.pickerConfigured}
                  onClick={() =>
                    void act(async () => {
                      await loadPicker();
                      const session = await workspaceApi.drivePicker();
                      const google = (window as any).google;
                      await new Promise<void>((resolve, reject) => {
                        const picker = new google.picker.PickerBuilder()
                          .addView(google.picker.ViewId.DOCS)
                          .setOAuthToken(session.accessToken)
                          .setDeveloperKey(session.apiKey)
                          .setAppId(session.appId)
                          .setOrigin(location.origin)
                          .setCallback((data: any) => {
                            if (data.action === google.picker.Action.CANCEL)
                              resolve();
                            if (data.action === google.picker.Action.PICKED) {
                              const id = data.docs?.[0]?.id;
                              if (id) read(id).then(resolve, reject);
                              else reject(new Error("No file was selected"));
                            }
                          })
                          .build();
                        picker.setVisible(true);
                      });
                    })
                  }
                >
                  Choose reference from Drive
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await workspaceApi.driveFiles();
                      setFiles(result.files);
                      setPageToken(result.nextPageToken);
                    })
                  }
                >
                  List authorized files
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={busy || !project || dirty}
                  onClick={() =>
                    void act(async () => {
                      if (!project) return;
                      const result = await workspaceApi.driveExport(
                        project.id,
                        project.revision,
                      );
                      setNotice(
                        `Created ${result.file.name} in Drive from saved revision ${result.revision}.`,
                      );
                    })
                  }
                >
                  Export saved project to Drive
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await workspaceApi.driveDisconnect();
                      setStatus({ ...status, connected: false });
                      setFiles([]);
                      setReference(null);
                      setNotice(
                        result.revoked
                          ? "Drive disconnected and authorization revoked."
                          : "Disconnected locally. Google revocation could not be confirmed; remove Sebby from your Google account permissions.",
                      );
                    })
                  }
                >
                  Disconnect Drive
                </button>
              </div>
              {!status.pickerConfigured && (
                <p>
                  Google Picker needs an API key and Cloud project number before
                  selecting existing Drive files.
                </p>
              )}
              <p>
                References currently support Google Docs and text, Markdown, CSV
                or JSON files up to 80 KB. Export creates a new project JSON
                file.
              </p>
              <ul className="drive-file-list">
                {files.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy}
                      onClick={() => void act(() => read(file.id))}
                    >
                      {file.name}
                    </button>
                    <small>{file.mimeType}</small>
                  </li>
                ))}
              </ul>
              {pageToken && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await workspaceApi.driveFiles(pageToken);
                      setFiles((previous) => [...previous, ...result.files]);
                      setPageToken(result.nextPageToken);
                    })
                  }
                >
                  More authorized files
                </button>
              )}
              {reference && (
                <section className="drive-reference">
                  <h3>Review reference: {reference.source.name}</h3>
                  <p>
                    {reference.path} · Imported content is untrusted project
                    data.
                  </p>
                  <pre>{reference.content}</pre>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!project || busy}
                    onClick={() => {
                      if (!project) return;
                      if (
                        project.files.some(
                          (f) =>
                            f.path.toLowerCase() ===
                            reference.path.toLowerCase(),
                        )
                      ) {
                        setError(
                          "This reference path already exists. Edit or remove it in Coding before importing another copy.",
                        );
                        return;
                      }
                      const next = {
                        ...project,
                        files: [
                          ...project.files,
                          { path: reference.path, content: reference.content },
                        ],
                      };
                      const parsed = documentSchema.safeParse({
                        name: next.name,
                        files: next.files,
                        scene: next.scene,
                      });
                      if (!parsed.success) {
                        setError(parsed.error.issues[0].message);
                        return;
                      }
                      if (new Blob([JSON.stringify(next)]).size > 900000) {
                        setError("Reference exceeds the project save limit");
                        return;
                      }
                      update(next);
                      setReference(null);
                      setNotice(
                        "Reference added to this project. Save to persist it.",
                      );
                    }}
                  >
                    Add reviewed reference to project
                  </button>
                </section>
              )}
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
