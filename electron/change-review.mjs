import { randomUUID } from "node:crypto";
/** Main-owned, bounded exact diff. Acknowledgment never applies a change by itself. */
export class ChangeReviewGate {
  constructor() {
    this.pending = null;
    this.closed = false;
  }
  list() {
    return this.pending ? structuredClone(this.pending.view) : null;
  }
  request(request, { signal } = {}) {
    if (this.closed || signal?.aborted) return Promise.resolve(false);
    if (this.pending) throw Error("Finish the open file-change review first.");
    if (
      !request?.diff ||
      typeof request.diff.text !== "string" ||
      request.diff.truncated ||
      Buffer.byteLength(request.diff.text) > 256 * 1024
    )
      throw Error("A bounded complete file diff is required.");
    const view = {
      id: randomUUID(),
      kind: request.kind,
      path: request.path,
      workspace: request.workspace,
      operation: request.operation,
      afterHash: request.afterHash,
      diff:
        request.kind === "undo-edit"
          ? request.diff.text
              .split("\n")
              .map((line) =>
                line.startsWith("+")
                  ? "-" + line.slice(1)
                  : line.startsWith("-")
                    ? "+" + line.slice(1)
                    : line,
              )
              .join("\n")
          : request.diff.text,
      removedLines:
        request.kind === "undo-edit"
          ? request.diff.addedLines
          : request.diff.removedLines,
      addedLines:
        request.kind === "undo-edit"
          ? request.diff.removedLines
          : request.diff.addedLines,
    };
    return new Promise((resolve) => {
      const abort = () => this.finish(false);
      this.pending = { view, resolve, signal, abort };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  respond(input) {
    if (
      !input ||
      typeof input.id !== "string" ||
      typeof input.accepted !== "boolean" ||
      Object.keys(input).some((k) => !["id", "accepted"].includes(k))
    )
      throw Error("Invalid review response.");
    if (!this.pending || this.pending.view.id !== input.id)
      throw Error("This file-change review is no longer pending.");
    this.finish(input.accepted);
    return { acknowledged: true };
  }
  finish(accepted) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.signal?.removeEventListener("abort", pending.abort);
    pending.resolve(accepted);
  }
  shutdown() {
    this.closed = true;
    this.finish(false);
  }
}
