import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BackupService } from "../electron/backup.mjs";
import { Store } from "../electron/services.mjs";
import { TaskStore } from "../electron/tasks.mjs";
async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "sebby-backup-test-")),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  await store.saveMemory(null, "Original memory");
  return { directory, store, backup: new BackupService(directory) };
}
const approved = { approve: async () => true, quiesce: async () => true };
test("export excludes credentials; preview rejects unknown paths and schema fields", async (t) => {
  const { directory, backup } = await fixture(t);
  await fs.writeFile(path.join(directory, "provider-vault.json"), "TOP SECRET");
  const payload = await backup.exportJSON();
  assert.ok(!payload.includes("TOP SECRET"));
  assert.deepEqual(Object.keys(JSON.parse(payload).stores), [
    "sebby-state.json",
  ]);
  for (const name of ["../outside.json", "provider-vault.json"]) {
    const data = JSON.parse(payload);
    data.stores[name] = {};
    await assert.rejects(backup.previewImport(JSON.stringify(data)), /unknown/);
  }
  const wrong = JSON.parse(payload);
  wrong.stores["sebby-state.json"].personality.apiKey = "no";
  await assert.rejects(backup.previewImport(JSON.stringify(wrong)), /unknown/);
  await assert.rejects(backup.previewImport("{"), /valid JSON/);
  await assert.rejects(
    backup.previewImport("x".repeat(20 * 1024 * 1024 + 1)),
    /20 MiB/,
  );
});
test("restore requires approval and stopped writers, retains originals and interrupts tasks", async (t) => {
  const { directory, store, backup } = await fixture(t);
  const tasks = new TaskStore(directory);
  await tasks.load();
  const task = await tasks.create({
    title: "Task",
    prompt: "Do work",
    role: "planner",
  });
  await tasks.transition(task.id, "running");
  const payload = await backup.exportJSON();
  assert.equal(
    JSON.parse(payload).stores["sebby-tasks.json"].tasks[0].status,
    "interrupted",
  );
  assert.equal(tasks.get(task.id).status, "running");
  await store.saveMemory(null, "Changed since backup");
  let preview = await backup.previewImport(payload);
  assert.deepEqual(
    await backup.restore(preview.token, {
      ...approved,
      approve: async () => false,
    }),
    { restored: false },
  );
  await assert.rejects(
    backup.restore(preview.token, { ...approved, quiesce: async () => false }),
    /Stop all/,
  );
  const result = await backup.restore(preview.token, approved);
  assert.equal(result.restored, true);
  assert.equal(result.restartRequired, true);
  assert.match(
    await fs.readFile(
      path.join(result.recoveryDirectory, "sebby-state.json"),
      "utf8",
    ),
    /Changed since backup/,
  );
  const restored = new Store(directory);
  await restored.load();
  assert.equal(restored.state(null).memory, "Original memory");
  const restoredTasks = new TaskStore(directory);
  await restoredTasks.load();
  assert.equal(restoredTasks.get(task.id).status, "interrupted");
  await assert.rejects(backup.restore(preview.token, approved), /Preview/);
});
test("invalid store content is rejected by service validators without touching live data", async (t) => {
  const { directory, backup } = await fixture(t);
  const before = await fs.readFile(
    path.join(directory, "sebby-state.json"),
    "utf8",
  );
  const data = JSON.parse(await backup.exportJSON());
  data.stores["sebby-state.json"].personality.warmth = "root";
  await assert.rejects(
    backup.previewImport(JSON.stringify(data)),
    /could not be loaded/,
  );
  assert.equal(
    await fs.readFile(path.join(directory, "sebby-state.json"), "utf8"),
    before,
  );
});
test("restore rolls back all stores when a later replacement fails", async (t) => {
  const { directory, store, backup } = await fixture(t);
  const tasks = new TaskStore(directory);
  await tasks.load();
  await tasks.create({
    title: "Original task",
    prompt: "Plan",
    role: "planner",
  });
  const payload = await backup.exportJSON();
  await store.saveMemory(null, "Current memory");
  const beforeState = await fs.readFile(
      path.join(directory, "sebby-state.json"),
      "utf8",
    ),
    beforeTasks = await fs.readFile(
      path.join(directory, "sebby-tasks.json"),
      "utf8",
    );
  const preview = await backup.previewImport(payload),
    rename = fs.rename;
  let injected = false;
  fs.rename = async (source, target) => {
    if (!injected && source.endsWith("sebby-tasks.json.new")) {
      injected = true;
      throw Error("Injected rename failure");
    }
    return rename(source, target);
  };
  try {
    await assert.rejects(
      backup.restore(preview.token, approved),
      /Previous local stores were restored/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(injected, true);
  assert.equal(
    await fs.readFile(path.join(directory, "sebby-state.json"), "utf8"),
    beforeState,
  );
  assert.equal(
    await fs.readFile(path.join(directory, "sebby-tasks.json"), "utf8"),
    beforeTasks,
  );
  assert.deepEqual(await backup.recoverPending(), { recovered: false });
});
test("startup recovery rolls back interrupted restore; malformed journal cannot escape", async (t) => {
  const { directory, backup } = await fixture(t);
  const transactionId = randomUUID(),
    recovery = path.join(directory, `sebby-recovery-${transactionId}`);
  await fs.mkdir(recovery);
  const file = path.join(directory, "sebby-state.json");
  await fs.copyFile(file, path.join(recovery, "sebby-state.json"));
  await fs.writeFile(file, "Partial replacement");
  const journal = path.join(directory, ".sebby-restore.json");
  await fs.writeFile(
    journal,
    JSON.stringify({
      version: 1,
      transactionId,
      files: [{ name: "sebby-state.json", existed: true }],
    }),
  );
  assert.deepEqual(await backup.recoverPending(), {
    recovered: true,
    restartRequired: true,
  });
  assert.match(await fs.readFile(file, "utf8"), /Original memory/);
  await fs.writeFile(
    journal,
    JSON.stringify({
      version: 1,
      transactionId,
      files: [{ name: "../outside", existed: true }],
    }),
  );
  await assert.rejects(backup.recoverPending(), /Invalid restore journal/);
});
test("linked source store is rejected", async (t) => {
  const { directory, backup } = await fixture(t);
  await fs.symlink(
    path.join(directory, "sebby-state.json"),
    path.join(directory, "sebby-tasks.json"),
  );
  await assert.rejects(backup.exportJSON(), /not links/);
});

test("backup includes team identities and rejects injected authority fields", async (t) => {
  const { directory, backup } = await fixture(t);
  const { TeamStore } = await import("../electron/team.mjs");
  const team = new TeamStore(directory);
  await team.load();
  await team.create({ role: "planner", job: "Plan the next verified step" });
  const payload = await backup.exportJSON(),
    data = JSON.parse(payload);
  assert.equal(data.stores["sebby-team.json"].team[0].name, "Mira");
  await backup.previewImport(payload);
  data.stores["sebby-team.json"].team[0].permissions = ["all"];
  await assert.rejects(backup.previewImport(JSON.stringify(data)), /unknown/);
});

test("appearance is backed up as strict metadata; asset URLs and CSS cannot be imported", async (t) => {
  const { directory, backup } = await fixture(t);
  const { AppearanceStore } = await import("../electron/appearance.mjs");
  const appearance = new AppearanceStore(directory);
  await appearance.load();
  await appearance.save({ pal: "scout", palettePreset: "mint", motion: false });
  const payload = await backup.exportJSON(),
    data = JSON.parse(payload);
  assert.equal(data.stores["sebby-appearance.json"].appearance.pal, "scout");
  await backup.previewImport(payload);
  data.stores["sebby-appearance.json"].appearance.url =
    "https://untrusted/model.glb";
  await assert.rejects(backup.previewImport(JSON.stringify(data)), /unknown/);
});

test("provider profile metadata exports but credentials and vault stay excluded", async (t) => {
  const { directory, backup } = await fixture(t);
  const { ProviderProfiles } =
    await import("../electron/provider-profiles.mjs");
  const profiles = new ProviderProfiles(directory);
  await profiles.load();
  const vault = path.join(directory, "sebby-profile-vault");
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, "private.credential"), "DO NOT EXPORT");
  const payload = await backup.exportJSON(),
    data = JSON.parse(payload);
  assert.ok(data.stores["sebby-provider-profiles.json"]);
  assert.ok(!payload.includes("DO NOT EXPORT"));
  await backup.previewImport(payload);
  data.stores["sebby-provider-profiles.json"].profiles[0].apiKey = "forbidden";
  await assert.rejects(backup.previewImport(JSON.stringify(data)));
});

test("GitHub backup includes strict metadata only and excludes its separate encrypted vault", async (t) => {
  const { directory, backup } = await fixture(t);
  const { GitHubConfig } = await import("../electron/github-storage.mjs");
  const config = new GitHubConfig(directory);
  await config.load();
  await config.save({
    owner: "example",
    repo: "demo",
    ref: "HEAD",
    useToken: true,
  });
  await fs.mkdir(path.join(directory, "sebby-github-vault"));
  await fs.writeFile(
    path.join(directory, "sebby-github-vault", "token.credential"),
    "SYNTHETIC_ENCRYPTED_SENTINEL",
  );
  const payload = await backup.exportJSON();
  assert.equal(
    JSON.parse(payload).stores["sebby-github.json"].configuration.repo,
    "demo",
  );
  assert.equal(payload.includes("SYNTHETIC_ENCRYPTED_SENTINEL"), false);
  const changed = JSON.parse(payload);
  changed.stores["sebby-github.json"].configuration.token = "forbidden";
  await assert.rejects(
    backup.previewImport(JSON.stringify(changed)),
    /Unsupported|unknown/,
  );
  changed.stores["sebby-github.json"] = {
    version: 2,
    configuration: {
      owner: "example",
      repo: "demo",
      ref: "HEAD",
      useToken: false,
    },
  };
  await assert.rejects(
    backup.previewImport(JSON.stringify(changed)),
    /version/,
  );
});

test("orchestration authority/evidence, MCP vault/history and isolation staging never enter backups", async (t) => {
  const { directory, backup } = await fixture(t);
  const secret = "SYNTHETIC_PRIVATE_EXCLUDED_SENTINEL";
  for (const relative of [
    "sebby-orchestration.json",
    "sebby-isolation.json",
    "sebby-mcp-vault/credentials.bin",
    "sebby-mcp-history/history.json",
    "sebby-isolation-staging/session/source.txt",
  ]) {
    const target = path.join(directory, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, secret);
  }
  const payload = await backup.exportJSON();
  assert.equal(payload.includes(secret), false);
  for (const name of [
    "sebby-orchestration.json",
    "sebby-isolation.json",
    "sebby-mcp-history/history.json",
  ]) {
    const input = JSON.parse(payload);
    input.stores[name] = {};
    await assert.rejects(
      () => backup.previewImport(JSON.stringify(input)),
      /unknown/,
    );
  }
});
