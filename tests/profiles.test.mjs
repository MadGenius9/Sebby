import test from "./platform-test.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ProviderProfiles,
  RuntimeProfileCredentials,
  validateProfilesDocument,
} from "../electron/provider-profiles.mjs";
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-profiles-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const profiles = new ProviderProfiles(directory);
  await profiles.load();
  return { directory, profiles };
}
const absentVault = {
  status: async () => ({
    configured: false,
    hasStoredCredential: false,
    secureStorageAvailable: true,
  }),
  getKey: async () => {
    throw Error("Not configured");
  },
};
test("default reuse profile seeds once with blank model and metadata CRUD/select persists", async (t) => {
  const { directory, profiles } = await fixture(t);
  const initial = profiles.selected();
  assert.equal(initial.provider, "openai");
  assert.equal(initial.useEnvironment, true);
  assert.equal(initial.model, "");
  const anthropic = await profiles.create({
    name: "Claude work",
    provider: "anthropic",
    model: "chosen-model",
  });
  assert.equal(anthropic.useEnvironment, false);
  await profiles.select(anthropic.id);
  await profiles.update(anthropic.id, {
    options: { maxOutputTokens: 4096 },
    name: "Claude revised",
  });
  const loaded = new ProviderProfiles(directory);
  await loaded.load();
  assert.equal(loaded.selected().id, anthropic.id);
  assert.equal(loaded.selected().options.maxOutputTokens, 4096);
  await loaded.remove(anthropic.id);
  assert.equal(loaded.selected().id, initial.id);
  await loaded.remove(initial.id);
  assert.equal(loaded.selected(), null);
  const empty = new ProviderProfiles(directory);
  await empty.load();
  assert.deepEqual(empty.list(), { profiles: [], selectedProfileId: null });
});
test("profile metadata rejects secret fields, endpoints, arbitrary env names, provider mutation and invalid options", async (t) => {
  const { profiles } = await fixture(t);
  for (const input of [
    { name: "bad", provider: "openai", apiKey: "secret" },
    { name: "bad", provider: "openai", baseURL: "https://evil.com" },
    { name: "bad", provider: "openai", envName: "SECRET" },
    { name: "bad", provider: "other" },
    { name: "bad", provider: "openai", options: { temperature: 1 } },
    { name: "bad", provider: "openai", options: { maxOutputTokens: 99999 } },
    { name: "sk-proj-this-is-secret-not-metadata", provider: "openai" },
    { name: "bad", provider: "openai", model: "https://api.example.com" },
  ])
    await assert.rejects(profiles.create(input));
  await assert.rejects(
    profiles.update(profiles.selected().id, { provider: "anthropic" }),
  );
  await assert.rejects(
    profiles.create({
      name: profiles.selected().name.toUpperCase(),
      provider: "xai",
    }),
  );
  assert.throws(() => profiles.get("../credential"));
});
test("concurrent metadata writes serialize and returned snapshots cannot mutate stored profiles", async (t) => {
  const { directory, profiles } = await fixture(t);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      profiles.create({ name: `Profile ${i}`, provider: "xai" }),
    ),
  );
  const returned = profiles.list();
  returned.profiles[0].name = "tampered";
  assert.notEqual(profiles.selected().name, "tampered");
  const loaded = new ProviderProfiles(directory);
  await loaded.load();
  assert.equal(loaded.list().profiles.length, 9);
});
test("corrupt, linked, oversized and authority-expanded registry data fails without overwriting", async (t) => {
  const { directory, profiles } = await fixture(t);
  const file = path.join(directory, "sebby-provider-profiles.json");
  const serialized = await fs.readFile(file, "utf8");
  await fs.writeFile(file, "{broken");
  await assert.rejects(
    new ProviderProfiles(directory).load(),
    /not overwritten/,
  );
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
  await fs.unlink(file);
  const target = path.join(directory, "target.json");
  await fs.writeFile(target, serialized);
  await fs.symlink(target, file);
  await assert.rejects(new ProviderProfiles(directory).load());
  await fs.unlink(file);
  await fs.writeFile(file, "x".repeat(128 * 1024 + 1));
  await assert.rejects(new ProviderProfiles(directory).load());
  assert.throws(() =>
    validateProfilesDocument({
      version: 1,
      ...profiles.list(),
      apiKey: "forbidden",
    }),
  );
});
test("runtime credentials use only explicitly enabled fixed provider environment names and never return keys in status", async (t) => {
  const { profiles } = await fixture(t);
  const env = {
    OPENAI_API_KEY: "OPENAI_TEST_SENTINEL_NOT_REAL",
    ANTHROPIC_API_KEY: "ANTHROPIC_TEST_SENTINEL_NOT_REAL",
    XAI_API_KEY: "XAI_TEST_SENTINEL_NOT_REAL",
    ARBITRARY: "DO_NOT_READ",
  };
  const openai = new RuntimeProfileCredentials(profiles.selected().id, {
    profiles,
    vault: absentVault,
    env,
  });
  assert.equal((await openai.status()).source, "environment");
  assert.equal(await openai.getKey(), env.OPENAI_API_KEY);
  const profile = await profiles.create({
    name: "Anthropic",
    provider: "anthropic",
  });
  const anthropic = new RuntimeProfileCredentials(profile.id, {
    profiles,
    vault: absentVault,
    env,
  });
  assert.equal((await anthropic.status()).configured, false);
  await assert.rejects(anthropic.getKey());
  await profiles.update(profile.id, { useEnvironment: true });
  assert.equal(await anthropic.getKey(), env.ANTHROPIC_API_KEY);
  assert.equal(
    JSON.stringify(await anthropic.status()).includes("SENTINEL"),
    false,
  );
});
test("stored vault credential takes precedence and vault failure never silently falls back to environment", async (t) => {
  const { profiles } = await fixture(t);
  const vault = {
    status: async () => ({
      configured: false,
      hasStoredCredential: true,
      secureStorageAvailable: false,
    }),
    getKey: async () => {
      throw Error("Vault unavailable");
    },
  };
  const resolver = new RuntimeProfileCredentials(profiles.selected().id, {
    profiles,
    vault,
    env: { OPENAI_API_KEY: "ENV_TEST_SENTINEL_NOT_REAL" },
  });
  assert.equal((await resolver.status()).source, "unavailable-vault");
  assert.equal((await resolver.status()).configured, false);
  await assert.rejects(resolver.getKey(), /Vault unavailable/);
});
