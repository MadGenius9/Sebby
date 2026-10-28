import { randomUUID } from "node:crypto";
import { PREVIEW_CSP } from "./preview.mjs";
/** Inject Electron constructors only from main. No project code runs in this process. */
export function previewWindowAdapter({ BrowserWindow, session }) {
  return {
    async openWindow({ id, url, onClosed, signal }) {
      if (
        signal?.aborted ||
        typeof id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(id) ||
        typeof url !== "string" ||
        url.length > 400000 ||
        !url.startsWith("data:text/html;charset=utf-8;base64,")
      )
        throw Error("Invalid isolated preview payload.");
      const html = Buffer.from(
        url.slice(url.indexOf(",") + 1),
        "base64",
      ).toString("utf8");
      const localURL = `https://sebby-preview.invalid/${id}`;
      const isolated = session.fromPartition(`sebby-preview-${randomUUID()}`, {
        cache: false,
      });
      isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      isolated.setPermissionCheckHandler(() => false);
      isolated.setDevicePermissionHandler(() => false);
      isolated.on("will-download", (event) => event.preventDefault());
      isolated.webRequest.onBeforeRequest((details, callback) =>
        callback({
          cancel:
            details.url !== localURL && !details.url.startsWith("data:image/"),
        }),
      );
      // Every HTTPS request in this private session is handled locally, never forwarded.
      isolated.protocol.handle("https", (request) =>
        request.url === localURL && request.method === "GET"
          ? new Response(html, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Security-Policy": `${PREVIEW_CSP}; sandbox`,
                "Permissions-Policy":
                  "camera=(), microphone=(), geolocation=(), usb=(), serial=(), payment=(), clipboard-read=(), clipboard-write=(), display-capture=()",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Cache-Control": "no-store",
                "X-DNS-Prefetch-Control": "off",
              },
            })
          : new Response("Blocked", { status: 403 }),
      );
      let win;
      try {
        win = new BrowserWindow({
          width: 1000,
          height: 760,
          minWidth: 400,
          minHeight: 300,
          show: false,
          title: "UNTRUSTED PREVIEW — no account access",
          autoHideMenuBar: true,
          fullscreenable: false,
          webPreferences: {
            session: isolated,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
            plugins: false,
            spellcheck: false,
            devTools: false,
            disableDialogs: true,
            navigateOnDragDrop: false,
            autoplayPolicy: "document-user-activation-required",
            disableHtmlFullscreenWindowResize: true,
            webgl: false,
            javascript: false,
          },
        });
      } catch {
        isolated.protocol.unhandle("https");
        throw Error("Static preview window could not be created.");
      }
      win.setMenu(null);
      let finished = false,
        timer,
        rejectTermination;
      const termination = new Promise((_, reject) => {
        rejectTermination = reject;
      });
      const destroy = () => {
        if (!win.isDestroyed()) win.destroy();
      };
      const notify = () => {
        if (finished) return;
        finished = true;
        rejectTermination(Error("Preview closed."));
        clearTimeout(timer);
        signal?.removeEventListener("abort", destroy);
        try {
          isolated.protocol.unhandle("https");
        } catch {}
        void isolated.clearStorageData().catch(() => {});
        onClosed?.();
      };
      win.on("closed", notify);
      win.on("unresponsive", destroy);
      win.on("page-title-updated", (event) => event.preventDefault());
      const wc = win.webContents;
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      for (const name of [
        "will-navigate",
        "will-frame-navigate",
        "will-redirect",
        "will-attach-webview",
      ])
        wc.on(name, (event) => event.preventDefault());
      wc.on("will-prevent-unload", (event) => event.preventDefault());
      wc.on("render-process-gone", destroy);
      wc.on("before-input-event", (event, input) => {
        if (input.key === "Escape") {
          event.preventDefault();
          destroy();
        } else if (
          (input.control || input.meta) &&
          ["o", "p", "s", "r"].includes(input.key?.toLowerCase())
        )
          event.preventDefault();
      });
      signal?.addEventListener("abort", destroy, { once: true });
      try {
        const initialize = async () => {
          wc.debugger.attach("1.3");
          wc.debugger.on("detach", destroy);
          await wc.debugger.sendCommand("Page.enable");
          if (signal?.aborted || win.isDestroyed())
            throw Error("Preview cancelled.");
          await wc.debugger.sendCommand("Page.setInterceptFileChooserDialog", {
            enabled: true,
            cancel: true,
          });
          if (signal?.aborted || win.isDestroyed())
            throw Error("Preview cancelled.");
          await win.loadURL(localURL);
        };
        timer = setTimeout(() => {
          rejectTermination(Error("Preview startup timed out."));
          destroy();
        }, 10000);
        await Promise.race([initialize(), termination]);
        clearTimeout(timer);
        if (signal?.aborted || win.isDestroyed())
          throw Error("Preview cancelled.");
        win.show();
        return win;
      } catch {
        destroy();
        throw Error(
          "Static preview could not start. Required browser guards may be unavailable.",
        );
      }
    },
    closeWindow: async (win) => {
      if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
