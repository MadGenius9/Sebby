# Drive and computer connections

Connections are explicit. Opening Sebby does not authorize a Google account or a computer. These integrations have API/fixture coverage; live Google authorization and native Windows behavior remain release gates.

## Google Drive

Configure an OAuth **Web application** in your Google Cloud project. Enable Drive API and Google Picker API. Set the authorized callback to the exact `<SERVER_URL>/api/drive/callback` and the JavaScript origin to your app origin. Configure these server environment variables:

```text
SEBBY_GOOGLE_CLIENT_ID=<your OAuth client ID>
SEBBY_GOOGLE_CLIENT_SECRET=<your OAuth client secret>
SEBBY_CONNECTOR_KEY=<separate random secret of at least 32 characters>
SEBBY_GOOGLE_PICKER_KEY=<browser API key restricted to your origin and Picker API>
SEBBY_GOOGLE_APP_ID=<numeric Cloud project number>
```

Generate your connector key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep credentials outside Git. Back up the encryption key separately from the SQLite database. Losing/changing it requires reconnecting existing accounts. The server accepts HTTPS app/server URLs or loopback HTTP for development.

In **Connections**, choose **Connect Google Drive**. Sebby requests only `drive.file`, with PKCE and a single-use, session-bound state. This scope covers files selected through Google Picker or created with Sebby; it does not provide access to your entire Drive. Picker requires its public API key and project number. Google may require consent-screen setup, test users or verification for your deployment. Sebby sign-in and Drive authorization are separate.

Choose a Google Doc or UTF-8 text/Markdown/CSV/JSON file under 80 KB. Review the fetched text and source metadata before adding it to the active project, then Save. The reference includes the file ID, observed modification time and SHA-256 of fetched content. Metadata and content requests are not an atomic Google snapshot. References are project data: assigning an agent to that project makes those saved files available to that agent.

**Export saved project to Drive** creates a new JSON file from the exact saved revision. It does not overwrite an existing Drive file, change sharing or delete remote files. **Disconnect Drive** removes local tokens and cancels pending authorization, then attempts Google revocation. A failed revocation is reported; remove the grant in your Google account if needed. Already-sent remote uploads may complete while disconnecting.

Access/refresh tokens are encrypted with AES-256-GCM using owner-bound additional authenticated data. Refresh uses a connection-ID/ciphertext compare-and-swap so revocation cannot be undone by an in-flight refresh. The short-lived access token is sent to the authenticated browser only when needed by Google Picker; it is not saved in localStorage. Responses are no-store. Do not store OAuth credentials, tokens or private reference contents in the public source repository.

## Selected-folder computer companion

The Node companion runs on the computer containing your project folder. It makes outbound requests to Sebby and opens no inbound port. This is a source-file bridge, not a desktop-control service or native installer.

1. Extract the Sebby Windows test ZIP on that computer, or obtain the Sebby source and install Node 22+.
2. Open **Connections → My computer → Create pairing code**.
3. On Windows, open **Connect-Folder.cmd** from the extracted ZIP. Enter the displayed address, the folder path, and the pairing code. On a source checkout, expand **Pair from the command line** and run the displayed command, replacing the folder path:

```bash
node scripts/companion.mjs --server https://YOUR_SEBBY --root "YOUR_PROJECT_FOLDER" --code YOUR_ONE_TIME_CODE
```

The code is single-use and expires after five minutes. Select a project subfolder; the CLI refuses your home folder or filesystem root. The selected folder name, computer label and read/write capability are displayed in Sebby. The server never receives the absolute root path.

Read-only mode is the default. Choose **Browse source**, read a listed file and **Add to project** to edit it in Sebby. Save edits. To permit writing reviewed changes back, revoke and re-pair, then enter `WRITE` in the Windows setup or append `--allow-write` to the manual command. Read the computer file again, review the replacement content, then choose **Write saved project file to computer**. Writes require the expected content hash and an unchanged regular file, and save a local backup first. This increment does not create files, delete files, install packages, run commands, control applications or allow agents to operate the companion automatically.

Allowed files are bounded UTF-8 source text under 100 KB. Environment files, common credentials, generated/dependency folders, links, hardlinks, device names and traversal paths are refused. Binary assets are unsupported. Filename filtering does not detect every secret embedded in source. Limits are 200 listed files, depth 8 and 2,000 visited entries. New directories are not created by writes.

The companion stores its token, selected root, backups and action log under your local `~/.config/sebby` directory. Logs record operation/path/outcome, never source contents; backups contain the previous file content. File permissions are requested as private on supported systems. `SEBBY_COMPANION_CONFIG_DIR` can select another local configuration directory outside the selected source folder. Tokens are stored hashed on the server, expire after 30 days and are revocable. To reconnect in the Windows setup, leave the code blank and enter the same server, folder and write mode. In the manual command, omit `--code`. Stop with Ctrl+C; revoke in Sebby to disable the token permanently.

Queued work expires after a minute; transient source payloads are cleared after ten minutes when the broker is used again. Disconnect/revocation blocks new dispatches; a file operation already executing on the computer can finish. A lost acknowledgement can leave a successful local write reported as expired: inspect the computer file before retrying. Backups have no automatic retention limit yet.

This client runs under your OS account. Path checks are not a hostile multi-process filesystem sandbox; do not point it at trees being manipulated by an untrusted local process. Native Windows filesystem/permissions and antivirus behavior still require testing. Do not expose the development email-selector server publicly; use real full-service authentication for a remote deployment.

## Verification

Five Drive tests use an injected transport with fixed Google endpoints. They check scope, PKCE, state/session replay, encryption, owners, references, saved-revision exports, refresh, disconnect races and revocation reporting. No live Google account was accessed.

Five companion tests check hashed pairing, owners, scoped results, queue/expiry/replay, revocation, path/link policy, real file backups and read/write operations. The built-server HTTP smoke additionally runs the actual companion CLI in a separate process against disposable files and verifies read/write/revoke. The same built-server/real-CLI HTTP smoke also passed on hosted Windows Server 2022 in run 44011609262. Desktop installation, ACL and antivirus behavior remain unverified.
