import { sanitizeStaticDocument } from "./preview-sanitize.mjs";
import { createHash, randomUUID } from "node:crypto";
import { MAX_TEXT_BYTES, validateRelative } from "./services.mjs";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; font-src 'none'; media-src 'none'; manifest-src 'none'";
const unsafeLabel =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/;
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");
export function previewDocument(content) {
  if (
    typeof content !== "string" ||
    Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES ||
    content.includes("\0")
  )
    throw Error("Invalid preview document.");
  // This parser-encountered policy precedes every untrusted byte. Later policies
  // can restrict it further, but cannot relax it. No external base URL is used.
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">\n${sanitizeStaticDocument(content).html}`;
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`;
}
export class PreviewService {
  #active = null;
  #pending = null;
  #closed = false;
  #phase = "closed";
  #outcome = null;
  constructor({
    workspace,
    approve = async () => false,
    openWindow,
    closeWindow,
    onChange = () => {},
  }) {
    if (
      !workspace ||
      typeof openWindow !== "function" ||
      typeof closeWindow !== "function"
    )
      throw Error("Preview adapters are required.");
    Object.assign(this, {
      workspace,
      approve,
      openWindow,
      closeWindow,
      onChange,
    });
  }
  get isBusy() {
    return this.#pending !== null;
  }
  status() {
    return {
      phase: this.#phase,
      busy: this.isBusy,
      active: this.#active ? { ...this.#active.info } : null,
      lastOutcome: this.#outcome,
    };
  }
  #notify() {
    try {
      this.onChange(this.status());
    } catch {
      /* UI notifications cannot change lifecycle. */
    }
  }
  #assert(run) {
    if (this.#closed || run.controller.signal.aborted) throw Error("cancelled");
  }
  async open(input) {
    if (this.#closed) throw Error("Preview service is shut down.");
    if (this.isBusy) throw Error("Another preview operation is pending.");
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !Object.hasOwn(input, "path") ||
      typeof input.path !== "string" ||
      !/\.html?$/i.test(input.path) ||
      unsafeLabel.test(input.path)
    )
      throw Error("Choose one relative .html or .htm file.");
    validateRelative(input.path);
    if (!this.workspace.root || unsafeLabel.test(this.workspace.root))
      throw Error("Choose a project folder first.");
    const run = {
      id: randomUUID(),
      path: input.path,
      root: this.workspace.root,
      controller: new AbortController(),
    };
    this.#pending = run;
    this.#phase = "opening";
    this.#outcome = null;
    this.#notify();
    let opened = null;
    try {
      const first = await this.workspace.read(run.path);
      this.#assert(run);
      if (this.workspace.root !== run.root) throw Error("stale");
      // Validate bounds before asking the user; the safe Workspace also validates UTF-8.
      previewDocument(first.content);
      const sha256 = hash(first.content);
      const approved = await this.approve({
        id: run.id,
        path: run.path,
        workspace: run.root,
        sha256,
        bytes: Buffer.byteLength(first.content),
        replaces: this.#active?.info.path || null,
        warning:
          "Render a static HTML/CSS preview? JavaScript is disabled. Large markup or CSS can still consume resources or freeze the preview. No Node.js, preload, network, file access, external assets, AI access, or project changes are permitted. Markup is reduced to a static subset: scripts, resource hints, external URLs and active controls are removed or disabled. This is not a full project/server preview.",
      });
      this.#assert(run);
      if (approved !== true) throw Error("denied");
      if (this.workspace.root !== run.root) throw Error("stale");
      const second = await this.workspace.read(run.path);
      this.#assert(run);
      if (this.workspace.root !== run.root || hash(second.content) !== sha256)
        throw Error("stale");
      const url = previewDocument(second.content);
      // Keep a prior preview intact until explicit approval and revalidation.
      await this.#closeActive();
      this.#assert(run);
      let closedDuringOpen = false;
      const onClosed = () => {
        closedDuringOpen = true;
        if (this.#active?.info.id === run.id) {
          this.#active = null;
          this.#phase = this.isBusy ? "opening" : "closed";
          this.#notify();
        }
      };
      opened = await this.openWindow({
        id: run.id,
        url,
        csp: PREVIEW_CSP,
        path: run.path,
        sha256,
        onClosed,
        signal: run.controller.signal,
      });
      this.#assert(run);
      if (!opened || closedDuringOpen) throw Error("window-closed");
      this.#active = {
        handle: opened,
        info: { id: run.id, path: run.path, workspace: run.root, sha256 },
      };
      opened = null;
      this.#outcome = "opened";
    } catch (error) {
      this.#outcome =
        this.#closed || run.controller.signal.aborted
          ? "cancelled"
          : error?.message === "stale"
            ? "stale"
            : error?.message === "denied"
              ? "denied"
              : "error";
    } finally {
      if (opened) {
        try {
          await this.closeWindow(opened);
        } catch {
          /* adapter must force destroy */
        }
      }
      this.#pending = null;
      this.#phase = this.#active
        ? "open"
        : this.#outcome === "error" || this.#outcome === "stale"
          ? "error"
          : "closed";
      this.#notify();
    }
    return this.status();
  }
  async #closeActive() {
    if (!this.#active) return;
    const current = this.#active;
    await this.closeWindow(current.handle);
    if (this.#active === current) this.#active = null;
  }
  cancel() {
    const cancelled = !!this.#pending;
    this.#pending?.controller.abort();
    return { cancelled };
  }
  async close() {
    this.cancel();
    await this.#closeActive();
    this.#phase = this.isBusy ? "opening" : "closed";
    this.#notify();
    return this.status();
  }
  async shutdown() {
    this.#closed = true;
    await this.close();
  }
}
