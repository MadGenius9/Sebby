import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  Notification,
  safeStorage,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store, Workspace, validateNote } from "./services.mjs";
import { allowedResource } from "./resource-policy.mjs";
import { BackupService } from "./backup.mjs";
import { installBackup } from "./backup-ipc.mjs";
import { installLocalFeatures } from "./local-features.mjs";
import { installDevelopment } from "./development-ipc.mjs";
import { installLocalExecutor } from "./local-executor-ipc.mjs";
import { installNetworkFeatures } from "./network-ipc.mjs";
import { installNotifications } from "./notification-ipc.mjs";
import { ChangeReviewGate } from "./change-review.mjs";
import { AppearanceStore } from "./appearance.mjs";
import { installAI } from "./ai-ipc.mjs";
import { VoiceController } from "./voice-controller.mjs";
import { mediaPermissionPolicy } from "./media-permissions.mjs";
import { installGitHub } from "./github-ipc.mjs";
import { installGitHubPublishing } from "./github-publish-ipc.mjs";
import { installReviewedMcp } from "./mcp-reviewed-ipc.mjs";
import { installIsolation } from "./isolation-ipc.mjs";
import { PreviewService } from "./preview.mjs";
import { previewWindowAdapter } from "./preview-window.mjs";
const directory = path.dirname(fileURLToPath(import.meta.url));
const dev = !app.isPackaged && process.argv.includes("--dev");
const appURL = dev
  ? "http://127.0.0.1:5173/"
  : pathToFileURL(path.join(directory, "../dist/index.html")).href;
const workspace = new Workspace(),
  changeReview = new ChangeReviewGate();
let window,
  store,
  appearance,
  localFeatures,
  developmentTools,
  localExecutor,
  discovery,
  reviewedMcp,
  isolation,
  notificationController,
  aiServices,
  voiceController,
  github,
  githubPublishing,
  preview,
  reminderTimer;
let prompting = false,
  maintenance = false,
  activeRequests = 0,
  shutdownStarted = false,
  allowQuit = false;
function trusted(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== appURL
  )
    throw Error("Untrusted request rejected.");
}
const register = (name, action) =>
  ipcMain.handle(`sebby:${name}`, async (event, ...args) => {
    trusted(event);
    if (
      aiServices?.orchestration?.isBusy &&
      [
        "create-note",
        "preview-edit",
        "apply-edit",
        "undo-edit",
        "plan-command",
        "start-command",
        "configure-git",
        "start-local-utility",
        "retry-task",
        "remove-task",
        "assign-team-task",
        "retire-team-member",
      ].includes(name)
    )
      throw Error(
        "Finish or cancel the active coordinated plan before competing edits, commands or task changes.",
      );
    if (maintenance)
      throw Error(
        "Sebby is closing or restoring local data. Restart before continuing.",
      );
    activeRequests++;
    try {
      return await action(...args);
    } catch (error) {
      if (error.code === "EEXIST")
        throw Error("That file already exists. Sebby will not overwrite it.");
      if (error.code)
        throw Error(
          "The local operation could not be completed. Check permissions and try again.",
        );
      throw Error(error.message || "The local operation failed.");
    } finally {
      activeRequests--;
    }
  });
async function guardedDialog(method, ...args) {
  if (prompting) throw Error("Finish the open dialog first.");
  prompting = true;
  try {
    return await dialog[method](...args);
  } finally {
    prompting = false;
  }
}
async function confirm(title, detail) {
  const result = await guardedDialog("showMessageBox", window, {
    type: "question",
    title,
    message: title,
    detail,
    buttons: ["Cancel", "Confirm"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
async function currentState() {
  return {
    ...store.state(workspace.root),
    provider: aiServices
      ? await aiServices.provider.status()
      : { configured: false, status: "not-configured" },
  };
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 660,
    title: "Sebby",
    icon: path.join(directory, "../dist/orbit.png"),
    backgroundColor: "#0e1824",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const name of [
    "will-navigate",
    "will-frame-navigate",
    "will-attach-webview",
  ])
    window.webContents.on(name, (event) => event.preventDefault());
  window.webContents.on("render-process-gone", () => {
    void voiceController?.shutdown();
  });
  window.webContents.on("destroyed", () => {
    void voiceController?.shutdown();
    void preview?.close().catch(() => {});
  });
  await window.loadURL(appURL);
}
app.setName("Sebby");
if (process.platform === "win32") app.setAppUserModelId("dev.sebby.companion");
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on("second-instance", () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
if (hasLock)
  app
    .whenReady()
    .then(async () => {
      const mediaPolicy = mediaPermissionPolicy({
        getWindow: () => window,
        getVoice: () => voiceController,
        appURL,
        isClosing: () => maintenance,
      });
      session.defaultSession.setPermissionRequestHandler(mediaPolicy.request);
      session.defaultSession.setPermissionCheckHandler(mediaPolicy.check);
      session.defaultSession.on("will-download", (event) =>
        event.preventDefault(),
      );
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        allowedResource(details.url, path.join(directory, "../dist"), dev).then(
          (allowed) => callback({ cancel: !allowed }),
          () => callback({ cancel: true }),
        );
      });
      const dataDirectory = app.getPath("userData");
      await fs.mkdir(dataDirectory, { recursive: true });
      const backup = new BackupService(dataDirectory);
      await backup.recoverPending();
      store = new Store(dataDirectory);
      await store.load();
      register("get-state", () => currentState());
      register("third-party-notices", async () => {
        const file = path.join(directory, "../docs/THIRD-PARTY-NOTICES.md");
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024)
          throw Error("Bundled notices are unavailable.");
        return fs.readFile(file, "utf8");
      });
      register("save-memory", async (text) => {
        await store.saveMemory(workspace.root, text);
        return currentState();
      });
      register("save-personality", async (value) => {
        await store.savePersonality(value, workspace.root);
        return currentState();
      });
      register("choose-workspace", async () => {
        if (
          localExecutor?.isActive ||
          aiServices?.isBusy() ||
          developmentTools?.busy ||
          preview?.isBusy ||
          isolation?.isBusy() ||
          githubPublishing?.isBusy()
        )
          throw Error(
            "Finish or cancel active work before changing workspace.",
          );
        const result = await guardedDialog("showOpenDialog", window, {
          title: "Choose a project folder for Sebby",
          properties: ["openDirectory"],
          buttonLabel: "Use this project",
        });
        if (result.canceled || !result.filePaths[0]) return null;
        if (
          maintenance ||
          localExecutor?.isActive ||
          aiServices?.isBusy() ||
          developmentTools?.busy ||
          preview?.isBusy ||
          isolation?.isBusy() ||
          githubPublishing?.isBusy()
        )
          throw Error(
            "Active work changed while choosing a folder. Finish it before changing workspace.",
          );
        await preview?.close();
        await workspace.select(result.filePaths[0]);
        return currentState();
      });
      register("list-files", () => workspace.list());
      register("read-file", (relative) => workspace.read(relative));
      register("create-note", async (input) => {
        const note = validateNote(input),
          root = workspace.root;
        if (!root) throw Error("Choose a project folder first.");
        if (
          !(await confirm(
            "Create a local project note?",
            `Create ${note.name}?\nFolder: ${root}\n\nCreates one new file (${Buffer.byteLength(note.content)} bytes). Existing files are never overwritten.`,
          ))
        )
          return { created: false };
        if (workspace.root !== root)
          throw Error("Workspace changed. Try again.");
        return workspace.create(note);
      });
      register("pending-change-review", () => changeReview.list());
      register("respond-change-review", (input) => changeReview.respond(input));
      localFeatures = await installLocalFeatures({
        directory: dataDirectory,
        register,
        workspace,
        confirm,
        beforeConnectorRemoval: (id) => reviewedMcp?.beforeRemoveConnector(id),
        onConnectorRemoved: (id) => {
          discovery?.disconnect(id);
          reviewedMcp?.clearConnector(id);
        },
        beforeRemoveConversation: () => {
          if (aiServices?.chat.isActive)
            throw Error("Finish or cancel chat before deleting conversations.");
        },
        cancelActiveTask: (id) =>
          localExecutor?.active?.taskId === id
            ? localExecutor.cancel(id)
            : aiServices?.agents.active?.taskId === id
              ? aiServices.agents.cancel(id)
              : null,
      });
      developmentTools = installDevelopment({
        directory: dataDirectory,
        register,
        workspace,
        confirm,
        reviewChange: (request, options) =>
          changeReview.request(request, options),
        chooseGit: async () => {
          const result = await guardedDialog("showOpenDialog", window, {
            title: "Choose your trusted Git executable",
            properties: ["openFile"],
          });
          return result.canceled ? null : result.filePaths[0];
        },
      });
      localExecutor = installLocalExecutor({
        tasks: localFeatures.tasks,
        team: localFeatures.team,
        workspace,
        register,
        confirm,
      });
      discovery = installNetworkFeatures({
        connectors: localFeatures.connectors,
        register,
        confirm,
        isExternalBusy: () => reviewedMcp?.isBusy() || false,
      });
      reviewedMcp = await installReviewedMcp({
        directory: dataDirectory,
        safeStorage,
        connectors: localFeatures.connectors,
        register,
        confirm,
        isExternalBusy: () => discovery?.isBusy() || false,
      });
      notificationController = installNotifications({
        reminders: localFeatures.reminders,
        register,
        confirm,
        Notification,
      });
      reminderTimer = setInterval(() => {
        if (!maintenance) void notificationController.tick().catch(() => {});
      }, 30000);
      reminderTimer.unref?.();
      appearance = new AppearanceStore(dataDirectory);
      await appearance.load();
      register("get-appearance", () => appearance.get());
      register("save-appearance", (input) => appearance.save(input));
      aiServices = await installAI({
        directory: dataDirectory,
        safeStorage,
        register,
        workspace,
        store,
        features: localFeatures,
        development: developmentTools,
        isExternalBusy: () =>
          voiceController?.isBusy() ||
          developmentTools?.busy ||
          localExecutor?.isActive ||
          isolation?.isBusy() ||
          false,
        confirm,
        onEvent: (kind, event) => {
          if (window && !window.isDestroyed())
            window.webContents.send(
              kind === "chat" ? "sebby:chat-event" : "sebby:provider-changed",
              event,
            );
        },
      });
      voiceController = new VoiceController({
        getContext: () => aiServices.voiceContext(),
        approveCapture: (request) =>
          confirm(
            "Allow this microphone recording?",
            `${request.disclosure}\n\nOpenAI audio model: ${request.model}\nProvider profile: ${request.profileId}\nNo microphone access is granted before confirmation. No audio is saved to disk by Sebby.`,
          ),
        approveUpload: (request) =>
          confirm(
            "Send this recording to OpenAI for paid transcription?",
            `${JSON.stringify(request, null, 2)}\n\nAudio leaves this device only after confirmation. OpenAI API charges and retention policies apply. The transcript is not automatically sent to chat.`,
          ),
      });
      register("voice-status", () => voiceController.status());
      register("begin-voice-capture", (input) =>
        voiceController.begin(input, window.webContents.id),
      );
      register("end-voice-capture", (id) =>
        voiceController.end(id, window.webContents.id),
      );
      register("transcribe-voice", (input) =>
        voiceController.transcribe(input, window.webContents.id),
      );
      register("cancel-voice", (id) =>
        voiceController.cancel(id, window.webContents.id),
      );
      github = await installGitHub({
        directory: dataDirectory,
        safeStorage,
        register,
        confirm,
        isExternalBusy: () => githubPublishing?.isBusy() || false,
        onConfigurationChanged: () => githubPublishing?.clearCache(),
      });
      githubPublishing = await installGitHubPublishing({
        directory: dataDirectory,
        workspace,
        github,
        register,
        confirm,
      });
      preview = new PreviewService({
        workspace,
        ...previewWindowAdapter({ BrowserWindow, session }),
        approve: (request) =>
          confirm(
            "Open a static HTML/CSS preview?",
            `${request.path}\nWorkspace: ${request.workspace}\nSHA-256: ${request.sha256}\nBytes: ${request.bytes}\n\n${request.warning}\nDo not enter credentials or private data in preview content. Native preview isolation still requires platform validation.`,
          ),
      });
      const previewStatus = () => {
        const value = preview.status();
        return {
          status: value.phase,
          path: value.active?.path,
          hash: value.active?.sha256,
          outcome: value.lastOutcome,
        };
      };
      register("preview-status", previewStatus);
      register("open-preview", async (input) => {
        await preview.open(input);
        return previewStatus();
      });
      register("close-preview", async () => {
        await preview.close();
        return previewStatus();
      });
      isolation = await installIsolation({
        directory: dataDirectory,
        workspace,
        register,
        confirm,
        isExternalBusy: () =>
          aiServices?.isBusy() ||
          developmentTools?.busy ||
          localExecutor?.isActive ||
          preview?.isBusy ||
          false,
      });
      const guardedDialogs = {
        showSaveDialog: (...args) => guardedDialog("showSaveDialog", ...args),
        showOpenDialog: (...args) => guardedDialog("showOpenDialog", ...args),
      };
      installBackup({
        backup,
        register,
        dialog: guardedDialogs,
        getWindow: () => window,
        confirm,
        quiesce: async () => {
          if (
            activeRequests !== 1 ||
            developmentTools.running.size ||
            developmentTools.busy ||
            localExecutor.isActive ||
            notificationController.status().busy ||
            aiServices.isBusy() ||
            github.isBusy() ||
            isolation.isBusy() ||
            reviewedMcp.isBusy() ||
            discovery.isBusy() ||
            preview.isBusy
          )
            return false;
          maintenance = true;
          await preview.shutdown();
          return true;
        },
        restart: () =>
          setTimeout(() => {
            app.relaunch();
            app.exit(0);
          }, 300),
      });
      await createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
          void createWindow().catch(() => app.quit());
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Sebby could not start",
        error.message || "Local startup failed.",
      );
      app.quit();
    });
app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  maintenance = true;
  developmentTools?.shutdown();
  discovery?.shutdown();
  changeReview.shutdown();
  clearInterval(reminderTimer);
  notificationController?.shutdown();
  const drain = (async () => {
    await Promise.allSettled([
      localExecutor?.shutdown(),
      voiceController?.shutdown(),
      isolation?.shutdown(),
      reviewedMcp?.shutdown(),
      githubPublishing?.shutdown(),
      github?.shutdown(),
      preview?.shutdown(),
      aiServices?.shutdown(),
    ]);
    await Promise.allSettled(
      [
        store?.queue,
        appearance?.queue,
        aiServices?.profiles.queue,
        aiServices?.vault.queue,
        ...Object.values(localFeatures || {}).map((service) => service?.queue),
      ].filter(Boolean),
    );
  })();
  void Promise.race([
    drain,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).finally(() => {
    allowQuit = true;
    app.quit();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
