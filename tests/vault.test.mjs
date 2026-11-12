import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProfileVault } from "../electron/profile-vault.mjs";
// Deliberately fake reversible transform for unit tests, never production encryption.
const fakeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "test-keyring",
  encryptString: (key) =>
    Buffer.from([...Buffer.from(key)].map((byte) => byte ^ 0xa5)),
  decryptString: (buffer) =>
    Buffer.from([...buffer].map((byte) => byte ^ 0xa5)).toString("utf8"),
};
async function fixture(t, safeStorage = fakeStorage) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-vault-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    directory,
    vault: new ProfileVault(directory, { safeStorage }),
    id: randomUUID(),
  };
}
const key = "TEST_SENTINEL_NOT_A_REAL_CREDENTIAL";
test("confirmed encrypted credential save/read/status/removal never persists plaintext or returns secret metadata", async (t) => {
  const { directory, vault, id } = await fixture(t);
  await assert.rejects(vault.save(id, key), /confirmation/);
  assert.equal((await vault.status(id)).configured, false);
  assert.deepEqual(
    await vault.save(id, key, { confirmed: true, provider: "openai" }),
    { saved: true, profileId: id },
  );
  const payload = await fs.readFile(
    path.join(directory, "sebby-profile-vault", `${id}.credential`),
  );
  assert.equal(payload.includes(Buffer.from(key)), false);
  assert.equal(await vault.getKey(id, { provider: "openai" }), key);
  const status = await vault.status(id);
  assert.equal(status.source, "os-encrypted");
  assert.equal(status.hasStoredCredential, true);
  assert.equal(JSON.stringify(status).includes("SENTINEL"), false);
  await assert.rejects(vault.remove(id), /confirmation/);
  await vault.remove(id, { confirmed: true, provider: "openai" });
  assert.equal((await vault.status(id)).hasStoredCredential, false);
});
test("unavailable or basic_text storage fails closed with no plaintext fallback", async (t) => {
  for (const storage of [
    { isEncryptionAvailable: () => false },
    { ...fakeStorage, getSelectedStorageBackend: () => "basic_text" },
  ]) {
    const { directory, vault, id } = await fixture(t, storage);
    await assert.rejects(
      vault.save(id, key, { confirmed: true, provider: "openai" }),
      /Plaintext fallback/,
    );
    assert.deepEqual(await fs.readdir(directory), []);
    assert.equal((await vault.status(id)).secureStorageAvailable, false);
    await assert.rejects(
      vault.getKey(id, { provider: "openai" }),
      /unavailable/,
    );
  }
});
test("invalid IDs, linked destinations/directories and oversized blobs are rejected", async (t) => {
  const { directory, vault, id } = await fixture(t);
  await assert.rejects(
    vault.save("../escape", key, { confirmed: true, provider: "openai" }),
  );
  await vault.save(id, key, { confirmed: true, provider: "openai" });
  const file = vault.file(id),
    outside = path.join(directory, "outside");
  await fs.writeFile(outside, "unchanged");
  await fs.unlink(file);
  await fs.symlink(outside, file);
  await assert.rejects(vault.status(id));
  await assert.rejects(vault.getKey(id, { provider: "openai" }));
  await assert.rejects(
    vault.save(id, key, { confirmed: true, provider: "openai" }),
  );
  assert.equal(await fs.readFile(outside, "utf8"), "unchanged");
  await fs.unlink(file);
  await fs.writeFile(file, Buffer.alloc(16 * 1024 + 1));
  await assert.rejects(vault.getKey(id, { provider: "openai" }));
  await fs.rm(vault.directory, { recursive: true });
  const linked = path.join(directory, "other");
  await fs.mkdir(linked);
  await fs.symlink(linked, vault.directory, "dir");
  await assert.rejects(
    vault.save(id, key, { confirmed: true, provider: "openai" }),
  );
});
test("concurrent vault writes/removal serialize and encryption/decryption failures expose no secrets", async (t) => {
  const { vault, id } = await fixture(t);
  await Promise.all([
    vault.save(id, key, { confirmed: true, provider: "openai" }),
    vault.save(id, `${key}_SECOND`, { confirmed: true, provider: "openai" }),
  ]);
  assert.equal(await vault.getKey(id, { provider: "openai" }), `${key}_SECOND`);
  vault.safeStorage = {
    ...fakeStorage,
    decryptString: () => {
      throw Error(key);
    },
  };
  await assert.rejects(
    vault.getKey(id, { provider: "openai" }),
    (error) => !error.message.includes(key),
  );
  vault.safeStorage = {
    ...fakeStorage,
    encryptString: () => {
      throw Error(key);
    },
  };
  await assert.rejects(
    vault.save(id, key, { confirmed: true, provider: "openai" }),
    (error) => !error.message.includes(key),
  );
  await vault.remove(id, { confirmed: true, provider: "openai" });
});

test("encrypted envelope binds key to provider and profile identity; legacy blobs fail closed", async (t) => {
  const { vault, id } = await fixture(t);
  await vault.save(id, key, { confirmed: true, provider: "openai" });
  await assert.rejects(
    vault.getKey(id, { provider: "anthropic" }),
    /No fallback/,
  );
  await assert.rejects(vault.getKey(id, { provider: "xai" }), /No fallback/);
  await assert.rejects(vault.getKey(id), /explicit supported provider/);
  const other = randomUUID();
  await fs.copyFile(vault.file(id), vault.file(other));
  await assert.rejects(
    vault.getKey(other, { provider: "openai" }),
    /No fallback/,
  );
  await fs.writeFile(vault.file(id), fakeStorage.encryptString(key));
  await assert.rejects(vault.getKey(id, { provider: "openai" }), /No fallback/);
});
test("restored profile metadata cannot redirect an existing key to another provider or fallback", async (t) => {
  const { directory, vault } = await fixture(t);
  const { ProviderProfiles, RuntimeProfileCredentials } =
    await import("../electron/provider-profiles.mjs");
  const profiles = new ProviderProfiles(directory);
  await profiles.load();
  const id = profiles.selected().id;
  await vault.save(id, key, { confirmed: true, provider: "openai" });
  const document = JSON.parse(await fs.readFile(profiles.file, "utf8"));
  document.profiles[0].provider = "anthropic";
  document.profiles[0].useEnvironment = true;
  await fs.writeFile(profiles.file, JSON.stringify(document));
  const restored = new ProviderProfiles(directory);
  await restored.load();
  const resolver = new RuntimeProfileCredentials(id, {
    profiles: restored,
    vault,
    env: { ANTHROPIC_API_KEY: "SHOULD_NOT_FALL_BACK_TEST_KEY" },
  });
  await assert.rejects(resolver.getKey(), /No fallback/);
});
