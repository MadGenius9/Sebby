import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
export const isolationStatus = () => ({
  available: false,
  reason: "native-engine-validation-required",
  implementation: "source-and-test-double-only",
});
export function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("Unknown isolation fields.");
}
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function configuration(value) {
  exact(value, ["cliPath", "cliSha256", "daemonEndpoint", "image"]);
  if (
    typeof value.cliPath !== "string" ||
    value.cliPath.length > 240 ||
    !(
      /^\/[a-zA-Z0-9_./ -]+$/.test(value.cliPath) ||
      /^[A-Z]:\\[a-zA-Z0-9_ .\\-]+\.exe$/i.test(value.cliPath)
    ) ||
    value.cliPath.split(/[\\/]/).includes("..")
  )
    throw Error("Choose an exact local CLI executable path.");
  if (
    typeof value.cliSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.cliSha256)
  )
    throw Error("Executable SHA-256 required.");
  if (
    !["npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock"].includes(
      value.daemonEndpoint,
    ) &&
    !/^unix:\/\/\/run\/user\/[1-9][0-9]{0,9}\/docker\.sock$/.test(
      value.daemonEndpoint,
    )
  )
    throw Error("Only reviewed local daemon endpoints are accepted.");
  if (
    typeof value.image !== "string" ||
    value.image.length > 240 ||
    !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/.test(value.image)
  )
    throw Error(
      "A named immutable image digest is required; tags/pulls are forbidden.",
    );
  return structuredClone(value);
}
export async function noLinks(target, directory = false) {
  const absolute = path.resolve(target),
    root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink())
      throw Error("Symlink paths are not accepted for isolation.");
  }
  const stat = await fs.lstat(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    throw Error("Wrong isolation path type.");
  return stat;
}
export class IsolationConfig {
  constructor(directory, { approve = async () => false } = {}) {
    this.directory = directory;
    this.file = path.join(directory, "sebby-isolation.json");
    this.approve = approve;
    this.loaded = false;
    this.value = null;
    this.tail = Promise.resolve();
  }
  serial(fn) {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => {});
    return p;
  }
  load() {
    return this.serial(async () => {
      this.loaded = false;
      await fs.mkdir(this.directory, { recursive: true });
      await noLinks(this.directory, true);
      try {
        const stat = await noLinks(this.file);
        if (stat.size > 8192) throw Error();
        const data = JSON.parse(await fs.readFile(this.file, "utf8"));
        exact(data, ["version", "configuration"]);
        if (data.version !== 1) throw Error();
        this.value =
          data.configuration === null
            ? null
            : configuration(data.configuration);
      } catch (error) {
        if (error.code !== "ENOENT")
          throw Error("Invalid isolation configuration preserved.");
        this.value = null;
      }
      this.loaded = true;
      return this.get();
    });
  }
  get() {
    if (!this.loaded) throw Error("Load isolation configuration first.");
    return { configuration: structuredClone(this.value), ...isolationStatus() };
  }
  save(input) {
    const checked = configuration(input);
    return this.serial(async () => {
      this.get();
      if (
        (await this.approve({
          action: "configure-unverified-isolation",
          configuration: structuredClone(checked),
          warning:
            "Local daemon control is privileged host access. This saves configuration only; execution remains unavailable.",
        })) !== true
      )
        return { approved: false, ...this.get() };
      await noLinks(this.directory, true);
      try {
        await noLinks(this.file);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const tmp = this.file + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(
          tmp,
          JSON.stringify({ version: 1, configuration: checked }),
          { flag: "wx", mode: 0o600 },
        );
        await fs.rename(tmp, this.file);
      } finally {
        await fs.rm(tmp, { force: true });
      }
      this.value = checked;
      return { approved: true, ...this.get() };
    });
  }
  async verifyExecutable() {
    const config = this.get().configuration;
    if (!config) throw Error("Isolation is not configured.");
    const stat = await noLinks(config.cliPath);
    if (stat.size > 256 * 1024 * 1024) throw Error("CLI executable too large.");
    if (hash(await fs.readFile(config.cliPath)) !== config.cliSha256)
      throw Error("CLI executable changed.");
    return structuredClone(config);
  }
}
