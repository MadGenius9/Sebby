import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../electron/services.mjs";
import {
  PreviewService,
  previewDocument,
  PREVIEW_CSP,
} from "../electron/preview.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(options = {}) {
  const calls = [];
  const workspace = {
    root: "/approved",
    read: async (p) => ({ path: p, content: "<h1>Preview</h1>" }),
  };
  const service = new PreviewService({
    workspace,
    approve: async (p) => {
      calls.push(["approve", p]);
      return true;
    },
    openWindow: async (p) => {
      calls.push(["open", p]);
      return { id: p.id };
    },
    closeWindow: async (h) => {
      calls.push(["close", h]);
    },
    ...options,
  });
  return { service, workspace, calls };
}
test("strict manual HTML input, no automatic work; policy precedes untrusted bytes", async () => {
  const { service, calls } = fixture();
  assert.equal(service.status().phase, "closed");
  assert.equal(calls.length, 0);
  for (const value of [
    { path: "../index.html" },
    { path: "file:///tmp/a.html" },
    { path: "a.js" },
    { path: "spoof\u202e.html" },
    { path: "line\n.html" },
    { path: "index.html", approved: true },
    { path: ".env.html" },
  ])
    await assert.rejects(service.open(value));
  const result = await service.open({ path: "index.html" });
  assert.equal(result.phase, "open");
  assert.equal(result.busy, false);
  assert.equal(result.lastOutcome, "opened");
  assert.equal(calls[0][0], "approve");
  assert.match(calls[0][1].warning, /static HTML\/CSS/);
  assert.equal(calls[1][0], "open");
  assert.equal(result.active.sha256, calls[1][1].sha256);
  assert.equal(JSON.stringify(result).includes("data:text"), false);
  const content =
    '<meta http-equiv="Content-Security-Policy" content="default-src *"><script>untrusted()</script>';
  const decoded = Buffer.from(
    previewDocument(content).split(",")[1],
    "base64",
  ).toString();
  assert.ok(decoded.includes(PREVIEW_CSP));
  assert.equal(decoded.includes("untrusted()"), false);
  assert.equal(decoded.includes("default-src *"), false);
  assert.match(PREVIEW_CSP, /script-src 'none'/);
  assert.match(PREVIEW_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_CSP, /base-uri 'none'/);
  assert.throws(() => previewDocument("a".repeat(256 * 1024 + 1)));
});
test("denial keeps old preview; approval replaces only after reread", async () => {
  let allow = true;
  const f = fixture({ approve: async () => allow });
  const first = await f.service.open({ path: "first.html" });
  allow = false;
  const denied = await f.service.open({ path: "second.htm" });
  assert.equal(denied.lastOutcome, "denied");
  assert.equal(denied.phase, "open");
  assert.equal(denied.active.id, first.active.id);
  assert.equal(f.calls.filter((c) => c[0] === "close").length, 0);
  allow = true;
  await f.service.open({ path: "second.htm" });
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["open", "close", "open"],
  );
});
test("changed source or selected workspace after approval never opens", async () => {
  for (const change of ["root", "content"]) {
    const f = fixture();
    let content = "one";
    f.workspace.read = async () => ({ content });
    f.service.approve = async () => {
      if (change === "root") f.workspace.root = "/other";
      else content = "two";
      return true;
    };
    const result = await f.service.open({ path: "index.html" });
    assert.equal(result.lastOutcome, "stale");
    assert.equal(f.calls.length, 0);
  }
});
test("cancel during read prevents consent; cancel during consent prevents opening and overlap", async () => {
  const read = deferred();
  const f = fixture();
  f.workspace.read = () => read.promise;
  const pending = f.service.open({ path: "index.html" });
  assert.equal(f.service.isBusy, true);
  await assert.rejects(f.service.open({ path: "other.html" }), /pending/);
  f.service.cancel();
  read.resolve({ content: "ok" });
  assert.equal((await pending).lastOutcome, "cancelled");
  assert.equal(f.calls.length, 0);
  const consent = deferred();
  const g = fixture({ approve: () => consent.promise });
  const run = g.service.open({ path: "index.html" });
  await new Promise((r) => setImmediate(r));
  g.service.cancel();
  consent.resolve(true);
  assert.equal((await run).lastOutcome, "cancelled");
  assert.equal(g.calls.length, 0);
});
test("shutdown during window opening disposes late handle; late closed callback cannot close successor", async () => {
  const ready = deferred();
  const f = fixture({ openWindow: () => ready.promise });
  const run = f.service.open({ path: "index.html" });
  await new Promise((r) => setImmediate(r));
  await f.service.shutdown();
  ready.resolve({ id: "late" });
  assert.equal((await run).lastOutcome, "cancelled");
  assert.deepEqual(f.calls.at(-1), ["close", { id: "late" }]);
  await assert.rejects(f.service.open({ path: "index.html" }), /shut down/);
  const g = fixture();
  await g.service.open({ path: "one.html" });
  const old = g.calls.find((c) => c[0] === "open")[1];
  const next = await g.service.open({ path: "two.html" });
  old.onClosed();
  assert.equal(g.service.status().active.id, next.active.id);
  g.calls
    .filter((c) => c[0] === "open")
    .at(-1)[1]
    .onClosed();
  assert.equal(g.service.status().phase, "closed");
});
test("adapter failure is sanitized; closed-before-load is not reported open", async () => {
  const f = fixture({
    openWindow: async () => {
      throw Error("private filesystem and document contents");
    },
  });
  const result = await f.service.open({ path: "index.html" });
  assert.equal(result.phase, "error");
  assert.equal(JSON.stringify(result).includes("private"), false);
  const g = fixture({
    openWindow: async (p) => {
      p.onClosed();
      return { id: p.id };
    },
  });
  assert.equal((await g.service.open({ path: "index.html" })).phase, "error");
});
test("real Workspace bounded read rejects symlinks, non UTF8 and oversized HTML, accepts htm", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-preview-"));
  try {
    const workspace = new Workspace();
    await workspace.select(root);
    await fs.writeFile(
      path.join(root, "index.html"),
      "<script>not executed by this test</script>",
    );
    await fs.writeFile(path.join(root, "other.htm"), "<h1>HTM</h1>");
    await fs.writeFile(
      path.join(root, "large.html"),
      "a".repeat(256 * 1024 + 1),
    );
    await fs.writeFile(path.join(root, "binary.html"), Buffer.from([0xff]));
    await fs.symlink(
      path.join(root, "index.html"),
      path.join(root, "link.html"),
    );
    const f = fixture({ workspace });
    assert.equal((await f.service.open({ path: "index.html" })).phase, "open");
    assert.equal(
      (await f.service.open({ path: "other.htm" })).lastOutcome,
      "opened",
    );
    for (const p of ["large.html", "binary.html", "link.html"])
      assert.equal((await f.service.open({ path: p })).lastOutcome, "error");
    assert.equal(f.calls.filter((c) => c[0] === "open").length, 2);
    await f.service.close();
    assert.equal(f.service.status().phase, "closed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
