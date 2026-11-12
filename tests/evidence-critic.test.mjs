import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace, MAX_TEXT_BYTES } from "../electron/services.mjs";
import { EvidenceWorkflow } from "../electron/evidence-workflow.mjs";

test("oversized replacement of a generated artifact is rejected before preview authority", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-evidence-critic-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "study.html"),
    "<main><h1>Authorized structural evidence</h1></main>",
  );
  const workspace = new Workspace();
  await workspace.select(project);
  let previews = 0;
  const workflow = new EvidenceWorkflow({
    workspace,
    dataDirectory: path.join(root, "data"),
    confirm: async () => true,
    preview: {
      openArtifact: async () => {
        previews++;
      },
    },
  });
  const { proposal } = await workflow.prepare({
    path: "study.html",
    authorized: true,
  });
  const { artifact } = await workflow.build({ proposalId: proposal.id });
  const handle = await fs.open(
    path.join(artifact.directory, artifact.path),
    "r+",
  );
  await handle.truncate(MAX_TEXT_BYTES + 1);
  await handle.close();
  await assert.rejects(
    workflow.previewBuild({ buildId: artifact.id }),
    /size limit/,
  );
  assert.equal(previews, 0);
  assert.equal(workflow.isBusy, false);
  await workflow.shutdown();
});
