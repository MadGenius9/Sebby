import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ArtifactWorkspace } from "../electron/artifact-workspace.mjs";
import { PreviewService } from "../electron/preview.mjs";
const original = "<h1>Original static study</h1>";
const sha256 = createHash("sha256").update(original).digest("hex");
function fixture() {
  let content = original;
  const adapter = new ArtifactWorkspace({
    root: null,
    select: async function (root) {
      this.root = root;
    },
    read: async () => ({ path: "index.html", content }),
  });
  return {
    adapter,
    change: () => {
      content = "<h1>Unexpected modified content</h1>";
    },
  };
}
test("artifact hash is enforced on every preview read, including before and after approval", async () => {
  for (const when of ["before", "during"]) {
    const { adapter, change } = fixture();
    await adapter.selectArtifact({
      directory: "/fixture",
      path: "index.html",
      sha256,
    });
    let opened = 0;
    const preview = new PreviewService({
      workspace: adapter,
      approve: async () => {
        if (when === "during") change();
        return true;
      },
      openWindow: async () => {
        opened++;
        return {};
      },
      closeWindow: async () => {},
    });
    if (when === "before") change();
    await preview.open({ path: "index.html" });
    assert.equal(opened, 0);
    assert.notEqual(preview.status().phase, "open");
    await preview.shutdown();
  }
});
test("artifact selection refuses extra paths and invalid identity; exact original stays readable", async () => {
  const { adapter } = fixture();
  await assert.rejects(adapter.read("index.html"));
  await assert.rejects(
    adapter.selectArtifact({
      directory: "/fixture",
      path: "other.html",
      sha256,
    }),
  );
  await adapter.selectArtifact({
    directory: "/fixture",
    path: "index.html",
    sha256,
  });
  assert.equal((await adapter.read("index.html")).content, original);
  await assert.rejects(adapter.read("other.html"));
});
