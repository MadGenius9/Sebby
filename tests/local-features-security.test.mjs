import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installLocalFeatures } from "../electron/local-features.mjs";
test("conversation deletion rechecks active chat after native consent before deleting history", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "sebby-features-review-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const handlers = new Map();
  let active = false,
    checks = 0;
  const services = await installLocalFeatures({
    directory,
    workspace: { root: null },
    register: (name, fn) => handlers.set(name, fn),
    beforeRemoveConversation: () => {
      checks++;
      if (active) throw Error("Active chat");
    },
    confirm: async () => {
      assert.equal(services.conversationRemovalPending, true);
      active = true;
      return true;
    },
  });
  const conversation = await services.conversations.create({
    title: "Keep my conversation",
  });
  await assert.rejects(
    handlers.get("remove-conversation")(conversation.id),
    /Active chat/,
  );
  assert.equal(services.conversationRemovalPending, false);
  assert.equal(checks, 2);
  assert.equal(
    services.conversations.get(conversation.id).title,
    "Keep my conversation",
  );
});
