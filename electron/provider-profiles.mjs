import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
export const PROVIDERS = Object.freeze(["openai", "anthropic", "xai"]);
export const PROVIDER_ENV = Object.freeze({
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
});
export const validProfileId = (id) =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const clone = (value) => structuredClone(value),
  MAX_BYTES = 128 * 1024;
const secretLike = (value) => /(?:sk-|xai-)[a-zA-Z0-9_-]{12,}/.test(value);
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error(
      "Unsupported profile fields. Keys, endpoints, headers, and environment names do not belong in profile metadata.",
    );
}
function name(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value) > 120 ||
    /[\x00-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value) ||
    secretLike(value)
  )
    throw Error("Choose a short, non-secret profile name.");
  return value.trim();
}
function model(value) {
  if (
    typeof value !== "string" ||
    (value !== "" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)) ||
    secretLike(value)
  )
    throw Error("Use a model identifier, not a key or endpoint URL.");
  return value;
}
function options(value = {}) {
  exact(value, ["maxOutputTokens"]);
  if (
    value.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(value.maxOutputTokens) ||
      value.maxOutputTokens < 256 ||
      value.maxOutputTokens > 8192)
  )
    throw Error("Output budget must be 256–8192 tokens.");
  return { maxOutputTokens: value.maxOutputTokens ?? 2048 };
}
export function validateProfile(value) {
  exact(value, [
    "id",
    "name",
    "provider",
    "model",
    "useEnvironment",
    "options",
  ]);
  if (
    !validProfileId(value.id) ||
    !PROVIDERS.includes(value.provider) ||
    typeof value.useEnvironment !== "boolean"
  )
    throw Error("Invalid provider profile.");
  return {
    id: value.id,
    name: name(value.name),
    provider: value.provider,
    model: model(value.model),
    useEnvironment: value.useEnvironment,
    options: options(value.options),
  };
}
export function validateProfilesDocument(value) {
  exact(value, ["version", "profiles", "selectedProfileId"]);
  if (
    value.version !== 1 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 50
  )
    throw Error("Invalid profile registry.");
  const profiles = value.profiles.map(validateProfile);
  if (
    new Set(profiles.map((p) => p.id)).size !== profiles.length ||
    new Set(profiles.map((p) => p.name.toLowerCase())).size !== profiles.length
  )
    throw Error("Duplicate profile identities.");
  if (
    value.selectedProfileId !== null &&
    (!validProfileId(value.selectedProfileId) ||
      !profiles.some((p) => p.id === value.selectedProfileId))
  )
    throw Error("Invalid selected profile.");
  return { version: 1, profiles, selectedProfileId: value.selectedProfileId };
}
/** Non-secret profile registry. Keys live only in the separately excluded vault. */
export class ProviderProfiles {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, "sebby-provider-profiles.json");
    this.data = null;
    this.queue = Promise.resolve();
  }
  assertReady() {
    if (!this.data) throw Error("Load provider profiles first.");
  }
  async load() {
    if (this.data) return this.list();
    try {
      const directoryStat = await fs.lstat(this.directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
        throw Error();
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw Error();
      const handle = await fs.open(
        this.file,
        constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_BYTES) throw Error();
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_BYTES) throw Error();
        this.data = validateProfilesDocument(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              buffer.subarray(0, bytesRead),
            ),
          ),
        );
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        throw Error(
          "Provider profiles could not be loaded. Existing data was not overwritten.",
        );
      const id = randomUUID();
      const initial = {
        version: 1,
        profiles: [
          {
            id,
            name: "OpenAI — existing environment key",
            provider: "openai",
            model: "",
            useEnvironment: true,
            options: { maxOutputTokens: 2048 },
          },
        ],
        selectedProfileId: id,
      };
      await this.write(initial);
      this.data = initial;
    }
    return this.list();
  }
  list() {
    this.assertReady();
    return clone({
      profiles: this.data.profiles,
      selectedProfileId: this.data.selectedProfileId,
    });
  }
  get(id) {
    this.assertReady();
    if (!validProfileId(id)) throw Error("Invalid profile ID.");
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) throw Error("Profile not found.");
    return clone(profile);
  }
  selected() {
    this.assertReady();
    return this.data.selectedProfileId
      ? this.get(this.data.selectedProfileId)
      : null;
  }
  async write(data) {
    const encoded = JSON.stringify(validateProfilesDocument(data), null, 2);
    if (Buffer.byteLength(encoded) > MAX_BYTES)
      throw Error("Profile registry is full.");
    await fs.mkdir(this.directory, { recursive: true });
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Unsafe profile storage directory.");
    try {
      const existing = await fs.lstat(this.file);
      if (!existing.isFile() || existing.isSymbolicLink())
        throw Error("Unsafe profile storage file.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const temp = path.join(this.directory, `.profiles-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, encoded, { flag: "wx", mode: 0o600 });
      await fs.rename(temp, this.file);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  }
  updateData(fn) {
    this.assertReady();
    const operation = this.queue.then(async () => {
      const next = clone(this.data);
      const result = fn(next);
      await this.write(next);
      this.data = next;
      return clone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async create(input) {
    exact(input, ["name", "provider", "model", "useEnvironment", "options"]);
    const profile = validateProfile({
      id: randomUUID(),
      name: input.name,
      provider: input.provider,
      model: input.model ?? "",
      useEnvironment: input.useEnvironment ?? false,
      options: input.options ?? {},
    });
    return this.updateData((data) => {
      if (data.profiles.length >= 50) throw Error("Profile limit reached.");
      if (
        data.profiles.some(
          (p) => p.name.toLowerCase() === profile.name.toLowerCase(),
        )
      )
        throw Error("Choose a distinct profile name.");
      data.profiles.push(profile);
      if (data.selectedProfileId === null) data.selectedProfileId = profile.id;
      return profile;
    });
  }
  async update(id, patch) {
    exact(patch, ["name", "model", "useEnvironment", "options"]);
    this.get(id);
    return this.updateData((data) => {
      const index = data.profiles.findIndex((p) => p.id === id);
      if (index < 0) throw Error("Profile not found.");
      const profile = validateProfile({ ...data.profiles[index], ...patch });
      if (
        data.profiles.some(
          (p) =>
            p.id !== id && p.name.toLowerCase() === profile.name.toLowerCase(),
        )
      )
        throw Error("Choose a distinct profile name.");
      data.profiles[index] = profile;
      return profile;
    });
  }
  async select(id) {
    this.get(id);
    return this.updateData((data) => {
      if (!data.profiles.some((p) => p.id === id))
        throw Error("Profile not found.");
      data.selectedProfileId = id;
      return { selectedProfileId: id };
    });
  }
  async remove(id) {
    this.get(id);
    return this.updateData((data) => {
      const index = data.profiles.findIndex((p) => p.id === id);
      if (index < 0) throw Error("Profile not found.");
      data.profiles.splice(index, 1);
      if (data.selectedProfileId === id)
        data.selectedProfileId = data.profiles[0]?.id ?? null;
      return { removed: true, selectedProfileId: data.selectedProfileId };
    });
  }
}
/** Main-only credential resolver. Never expose getKey through IPC. */
export class RuntimeProfileCredentials {
  constructor(profileId, { profiles, vault, env = process.env }) {
    if (!validProfileId(profileId)) throw Error("Invalid profile ID.");
    Object.assign(this, { profileId, profiles, vault, env });
  }
  async status() {
    const profile = this.profiles.get(this.profileId),
      stored = await this.vault.status(profile.id);
    if (stored.hasStoredCredential)
      return {
        configured: stored.configured,
        source: stored.configured ? "os-encrypted" : "unavailable-vault",
        secureStorageAvailable: stored.secureStorageAvailable,
      };
    const value = profile.useEnvironment
      ? this.env[PROVIDER_ENV[profile.provider]]
      : null;
    const configured =
      typeof value === "string" &&
      value.length >= 20 &&
      value.length <= 1024 &&
      /^[\x21-\x7e]+$/.test(value);
    return {
      configured,
      source: configured ? "environment" : "none",
      secureStorageAvailable: stored.secureStorageAvailable,
    };
  }
  async getKey() {
    const profile = this.profiles.get(this.profileId),
      stored = await this.vault.status(profile.id);
    if (stored.hasStoredCredential)
      return this.vault.getKey(profile.id, { provider: profile.provider });
    const value = profile.useEnvironment
      ? this.env[PROVIDER_ENV[profile.provider]]
      : null;
    if (
      typeof value !== "string" ||
      value.length < 20 ||
      value.length > 1024 ||
      !/^[\x21-\x7e]+$/.test(value)
    )
      throw Error("No existing credential is configured for this profile.");
    return value;
  }
}
