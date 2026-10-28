import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RuntimeCredentials,
  SecureCredentialStore,
} from "../electron/credentials.mjs";
const fake = "TEST_ONLY_NOT_A_REAL_SECRET_12345";
test("runtime credential status reveals presence only, no secret", () => {
  const credentials = new RuntimeCredentials({ env: { OPENAI_API_KEY: fake } });
  assert.deepEqual(credentials.status(), {
    configured: true,
    source: "environment",
  });
  assert.equal(JSON.stringify(credentials.status()).includes(fake), false);
  assert.equal(credentials.getKey(), fake);
  assert.throws(() => new RuntimeCredentials({ env: {} }).getKey());
});
test("secure storage fails closed when unavailable or basic_text", async () => {
  for (const safeStorage of [
    { isEncryptionAvailable: () => false },
    {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "basic_text",
    },
  ]) {
    const store = new SecureCredentialStore("/tmp/not-used", { safeStorage });
    assert.equal(store.supported(), false);
    await assert.rejects(store.save(fake, { confirmed: true }), /Plaintext/);
  }
});
test("optional encrypted persistence requires confirmation and roundtrips injected fake encryptor", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sebby-creds-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "test-encrypted",
    encryptString: (value) => Buffer.from(value.split("").reverse().join("")),
    decryptString: (value) => value.toString().split("").reverse().join(""),
  };
  const store = new SecureCredentialStore(dir, { safeStorage });
  await assert.rejects(store.save(fake), /approval/);
  await store.save(fake, { confirmed: true });
  assert.equal(await store.getKey(), fake);
  assert.equal((await fs.readFile(store.file, "utf8")).includes(fake), false);
  await assert.rejects(store.remove(), /Confirm/);
  await store.remove({ confirmed: true });
  assert.equal((await store.status()).configured, false);
});
