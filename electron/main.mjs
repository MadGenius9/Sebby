import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  Notification,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { BackupService } from "./backup.mjs";
import { installBackup } from "./backup-ipc.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store, Workspace, validateNote } from "./services.mjs";
import { installLocalFeatures } from "./local-features.mjs";
import { installNotifications } from "./notification-ipc.mjs";
import { installLocalExecutor } from "./local-executor-ipc.mjs";
import { installNetworkFeatures } from "./network-ipc.mjs";
import { installDevelopment } from "./development-ipc.mjs";
import { allowedResource } from "./resource-policy.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const dev = !app.isPackaged && process.argv.includes("--dev");
const appURL = dev
  ? "http://127.0.0.1:5173/"
  : pathToFileURL(path.join(directory, "../dist/index.html")).href;
let window;
const workspace = new Workspace();
let store;
let prompting = false;
let maintenance = false;
let activeRequests = 0;
let developmentTools;
let discovery;
let localFeatures;
let localExecutor;
let notificationController;
let reminderTimer;
const trusted = (event) => {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== appURL
  )
    throw new Error("Untrusted request rejected.");
};
const register = (name, action) =>
  ipcMain.handle(`sebby:${name}`, async (event, ...args) => {
    trusted(event);
    if (maintenance)
      throw Error(
        "Local data is being restored. Restart Sebby before continuing.",
      );
    activeRequests++;
    try {
      return await action(...args);
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          "That file already exists. Sebby will not overwrite it.",
        );
      if (error.code)
        throw new Error(
          "The local operation could not be completed. Check the folder permissions and try again.",
        );
      throw new Error(error.message || "The local operation failed.");
    } finally {
      activeRequests--;
    }
  });
async function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 660,
    title: "Sebby",
    icon: path.join(directory, "../dist/orbit.png"),
    backgroundColor: "#0b1018",
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
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  await window.loadURL(appURL);
}
app.setName("Sebby");
if (process.platform === "win32") app.setAppUserModelId("dev.sebby.companion");
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
if (hasInstanceLock)
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.on("will-download", (event) =>
        event.preventDefault(),
      );
      // Production has no network access. Development permits only the fixed local Vite server.
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        allowedResource(details.url, path.join(directory, "../dist"), dev).then(
          (allowed) => callback({ cancel: !allowed }),
          () => callback({ cancel: true }),
        );
      });
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      const backup = new BackupService(app.getPath("userData"));
      try {
        await backup.recoverPending();
      } catch (error) {
        dialog.showErrorBox(
          "Sebby backup recovery needs attention",
          error.message,
        );
        app.quit();
        return;
      }
      store = new Store(app.getPath("userData"));
      try {
        await store.load();
      } catch (error) {
        dialog.showErrorBox(
          "Sebby could not load local settings",
          `${error.message}\nCheck sebby-state.json in the application data folder before trying again.`,
        );
        app.quit();
        return;
      }
      register("get-state", () => store.state(workspace.root));
      register("save-memory", (text) => store.saveMemory(workspace.root, text));
      register("save-personality", (value) =>
        store.savePersonality(value, workspace.root),
      );
      register("choose-workspace", async () => {
        if (localExecutor?.isActive)
          throw Error(
            "Finish or cancel the active local utility before changing workspace.",
          );
        if (prompting) throw new Error("Finish the open dialog first.");
        prompting = true;
        try {
          const result = await dialog.showOpenDialog(window, {
            title: "Choose a project folder for Sebby",
            properties: ["openDirectory"],
            buttonLabel: "Use this project",
          });
          if (result.canceled || !result.filePaths[0]) return null;
          await workspace.select(result.filePaths[0]);
          return store.state(workspace.root);
        } finally {
          prompting = false;
        }
      });
      register("list-files", () => workspace.list());
      register("read-file", (relative) => workspace.read(relative));
      register("create-note", async (input) => {
        const note = validateNote(input);
        if (!workspace.root) throw new Error("Choose a project folder first.");
        if (prompting) throw new Error("Finish the open dialog first.");
        prompting = true;
        const selectedRoot = workspace.root;
        try {
          const result = await dialog.showMessageBox(window, {
            type: "question",
            title: "Create a local project note?",
            message: `Create ${note.name}?`,
            detail: `Folder: ${selectedRoot}\n\nThis creates one new text file (${Buffer.byteLength(note.content)} bytes). Existing files will never be overwritten.`,
            buttons: ["Cancel", "Create file"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) return { created: false };
          if (workspace.root !== selectedRoot)
            throw new Error("The selected workspace changed. Try again.");
          return await workspace.create(note);
        } finally {
          prompting = false;
        }
      });
      const confirm = async (title, detail) => {
        if (prompting) throw Error("Finish the open dialog first.");
        prompting = true;
        try {
          const result = await dialog.showMessageBox(window, {
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
        } finally {
          prompting = false;
        }
      };
      try {
        localFeatures = await installLocalFeatures({
          directory: app.getPath("userData"),
          register,
          workspace,
          confirm,
          onConnectorRemoved: (id) => discovery?.disconnect(id),
          cancelActiveTask: (id) =>
            localExecutor?.active?.taskId === id
              ? localExecutor.cancel(id)
              : null,
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
        });
        developmentTools = installDevelopment({
          directory: app.getPath("userData"),
          register,
          workspace,
          confirm,
          chooseGit: async () => {
            if (prompting) throw Error("Finish the open dialog first.");
            prompting = true;
            try {
              const result = await dialog.showOpenDialog(window, {
                title: "Choose your trusted Git executable",
                properties: ["openFile"],
              });
              return result.canceled ? null : result.filePaths[0];
            } finally {
              prompting = false;
            }
          },
        });
      } catch (error) {
        dialog.showErrorBox(
          "Sebby could not load local features",
          error.message,
        );
        app.quit();
        return;
      }
      const guardedDialogs = {
        showSaveDialog: async (...args) => {
          if (prompting) throw Error("Finish the open dialog first.");
          prompting = true;
          try {
            return await dialog.showSaveDialog(...args);
          } finally {
            prompting = false;
          }
        },
        showOpenDialog: async (...args) => {
          if (prompting) throw Error("Finish the open dialog first.");
          prompting = true;
          try {
            return await dialog.showOpenDialog(...args);
          } finally {
            prompting = false;
          }
        },
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
            localExecutor?.isActive ||
            notificationController?.status().busy
          )
            return false;
          maintenance = true;
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
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Sebby could not start",
        error.message || "Local startup failed.",
      );
      app.quit();
    });
let shutdownStarted = false,
  allowQuit = false;
app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  maintenance = true;
  developmentTools?.shutdown();
  discovery?.shutdown();
  clearInterval(reminderTimer);
  notificationController?.shutdown();
  const drain = (async () => {
    await localExecutor?.shutdown().catch(() => {});
    await Promise.allSettled(
      [
        store?.queue,
        ...Object.values(localFeatures || {}).map((service) => service?.queue),
      ].filter(Boolean),
    );
  })();
  const deadline = new Promise((resolve) => setTimeout(resolve, 3000));
  void Promise.race([drain, deadline]).finally(() => {
    allowQuit = true;
    app.quit();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
