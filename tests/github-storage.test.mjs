import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  GitHubConfig,
  GitHubVault,
  validateGitHubConfig,
} from "../electron/github-storage.mjs";
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "test",
  encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0xa5)),
  decryptString: (b) =>
    Buffer.from([...b].map((x) => x ^ 0xa5)).toString("utf8"),
};
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-github-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    directory,
    config: new GitHubConfig(directory),
    vault: new GitHubVault(directory, { safeStorage: fake }),
  };
}
test("GitHub config persists only explicit owner/repo/ref/token opt-in and rejects arbitrary authority", async (t) => {
  const { directory, config } = await fixture(t);
  assert.deepEqual(await config.load(), {
    owner: "",
    repo: "",
    ref: "HEAD",
    useToken: false,
  });
  const value = {
    owner: "owner",
    repo: "repo",
    ref: "feature/name",
    useToken: true,
  };
  await config.save(value);
  const restored = new GitHubConfig(directory);
  await restored.load();
  assert.deepEqual(restored.get(), value);
  for (const patch of [
    { url: "https://evil.com" },
    { token: "do not persist" },
    { owner: undefined },
    { owner: "a/b" },
    { repo: "../x" },
    { repo: "x.git" },
    { ref: "../HEAD" },
    { ref: "x?secret" },
    { useToken: "yes" },
  ])
    assert.throws(() => validateGitHubConfig({ ...value, ...patch }));
  await fs.writeFile(config.file, "{bad");
  await assert.rejects(new GitHubConfig(directory).load(), /not overwritten/);
  assert.equal(await fs.readFile(config.file, "utf8"), "{bad");
});
test("GitHub vault requires confirmation, encrypts dedicated host-bound envelope, and never returns token in status", async (t) => {
  const { directory, vault } = await fixture(t);
  const token = "TEST_ONLY_GITHUB_TOKEN_SENTINEL";
  await assert.rejects(vault.save(token), /confirmation/);
  await vault.save(token, { confirmed: true });
  assert.equal(await vault.getToken(), token);
  assert.equal(
    (await fs.readFile(vault.file)).includes(Buffer.from(token)),
    false,
  );
  assert.equal(
    JSON.stringify(await vault.status()).includes("SENTINEL"),
    false,
  );
  await assert.rejects(vault.remove(), /confirmation/);
  await fs.writeFile(
    vault.file,
    fake.encryptString(
      JSON.stringify({
        version: 1,
        service: "github-api",
        host: "evil.com",
        token,
      }),
    ),
  );
  await assert.rejects(vault.getToken(), /safely/);
  await vault.remove({ confirmed: true });
  assert.equal((await vault.status()).configured, false);
  const insecure = new GitHubVault(directory, {
    safeStorage: { ...fake, getSelectedStorageBackend: () => "basic_text" },
  });
  await assert.rejects(
    insecure.save(token, { confirmed: true }),
    /no plaintext/,
  );
});
test("vault rejects symlinks and sanitizes encryption/decryption errors", async (t) => {
  const { directory, vault } = await fixture(t);
  await fs.mkdir(vault.directory);
  const outside = path.join(directory, "outside");
  await fs.writeFile(outside, "unchanged");
  await fs.symlink(outside, vault.file);
  await assert.rejects(vault.getToken());
  await assert.rejects(
    vault.save("TEST_ONLY_SENTINEL_CREDENTIAL", { confirmed: true }),
  );
  assert.equal(await fs.readFile(outside, "utf8"), "unchanged");
  await fs.unlink(vault.file);
  vault.safeStorage = {
    ...fake,
    encryptString: () => {
      throw Error("SECRET_TOKEN");
    },
  };
  await assert.rejects(
    vault.save("TEST_ONLY_SENTINEL_CREDENTIAL", { confirmed: true }),
    (error) => !error.message.includes("SECRET_TOKEN"),
  );
});
test("token-like refs cannot be accidentally persisted as repository metadata", () => {
  for (const ref of [
    "ghp_TEST_ONLY_FAKE_TOKEN",
    "github_pat_TEST_ONLY_FAKE_TOKEN",
  ])
    assert.throws(() =>
      validateGitHubConfig({
        owner: "owner",
        repo: "repo",
        ref,
        useToken: false,
      }),
    );
});
