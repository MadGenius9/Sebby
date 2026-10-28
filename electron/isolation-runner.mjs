import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exact, hash, noLinks, isolationStatus } from "./isolation-config.mjs";
import { safeFile } from "./isolation-snapshot.mjs";
const RECIPES = Object.freeze(["web-build", "web-test"]);
function cancelled(signal) {
  if (signal?.aborted) throw Error("Isolation run cancelled.");
}
function relativeArtifact(value) {
  safeFile(value);
  if (
    value === "package.json" ||
    value === "package-lock.json" ||
    !/\.(?:html|css|js|json|map|txt|svg|png)$/.test(value)
  )
    throw Error("Unsupported artifact path.");
  return value;
}
export class IsolationRunner {
  constructor({
    config,
    snapshots,
    quarantineRoot,
    approve = async () => false,
  }) {
    this.config = config;
    this.snapshots = snapshots;
    this.root = path.resolve(quarantineRoot);
    this.approve = approve;
    this.active = false;
    this.closed = false;
  }
  status() {
    return { ...isolationStatus(), active: this.active };
  }
  async run() {
    throw Error(
      "Native isolation execution unavailable: no reviewed production transport or engine validation.",
    );
  }
  async shutdown() {
    this.closed = true;
    this.controller?.abort();
  }
  // Deliberately separate test-only entry point. Never register this method or its
  // transport argument on IPC. No production spawn/daemon implementation exists.
  async runWithTestTransport(request, transport) {
    exact(request, ["snapshotId", "recipe", "signal"]);
    if (!RECIPES.includes(request.recipe))
      throw Error("Unsupported fixed web recipe.");
    if (
      !transport ||
      transport.kind !== "test-double" ||
      typeof transport.execute !== "function"
    )
      throw Error("Only an injected test double is accepted.");
    if (this.closed || this.active)
      throw Error("Isolation runner unavailable or busy.");
    this.active = true;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    let id = null,
      attempted = false,
      cleanupVerified = false,
      configuration,
      snapshot;
    const nonce = randomUUID(),
      name = "sebby-" + nonce;
    let result, engineConfig;
    const invoke = async (args, { cleanup = false, maximum = 15000 } = {}) => {
      if (!cleanup) cancelled(controller.signal);
      const signal = cleanup ? undefined : controller.signal;
      let timer, onAbort;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Isolation transport deadline exceeded.")),
          maximum,
        );
        if (signal) {
          onAbort = () => reject(Error("Isolation run cancelled."));
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      try {
        const output = await Promise.race([
          transport.execute({
            executable: configuration.cliPath,
            args: [
              "--host",
              configuration.daemonEndpoint,
              "--config",
              engineConfig,
              ...args,
            ],
            environment: {},
            timeoutMs: maximum,
            maxOutputBytes: 2 * 1024 * 1024,
            signal,
          }),
          deadline,
        ]);
        exact(output, ["exitCode", "stdout", "stderr"]);
        if (
          !Number.isInteger(output.exitCode) ||
          typeof output.stdout !== "string" ||
          typeof output.stderr !== "string" ||
          Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) >
            2 * 1024 * 1024
        )
          throw Error("Invalid or excessive transport result.");
        if (output.exitCode !== 0)
          throw Error("Isolated engine operation failed.");
        return output.stdout;
      } finally {
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      }
    };
    const ownership = async (cleanup = false) => {
      if (!id) throw Error("Container identity is uncertain.");
      const raw = await invoke(["inspect", "--format={{json .}}", id], {
        cleanup,
        maximum: 5000,
      });
      let doc;
      try {
        doc = JSON.parse(raw);
      } catch {
        throw Error("Invalid container ownership evidence.");
      }
      if (
        doc.Id !== id ||
        doc.Name !== "/" + name ||
        doc.Config?.Image !== configuration.image ||
        doc.Config?.Labels?.["dev.sebby.operation"] !== nonce
      )
        throw Error("Container ownership not verified.");
    };
    try {
      cancelled(controller.signal);
      configuration = await this.config.verifyExecutable();
      snapshot = await this.snapshots.verify(request.snapshotId);
      cancelled(controller.signal);
      if (/[\r\n,]/.test(snapshot.directory))
        throw Error("Unsupported staged mount path.");
      if (
        (await this.approve({
          action: "test-isolated-web-recipe",
          mode: "test-double-only",
          recipe: request.recipe,
          image: configuration.image,
          daemonEndpoint: configuration.daemonEndpoint,
          snapshotHash: snapshot.snapshotHash,
          files: snapshot.files,
          limits: { seconds: 60, memoryMiB: 512, cpu: 1, pids: 64 },
          warning:
            "Source test transport only. Native engine isolation is unverified; no live execution is available.",
        })) !== true
      )
        throw Error("Isolated run declined.");
      cancelled(controller.signal);
      await this.snapshots.verify(snapshot.id);
      const recheckedConfiguration = await this.config.verifyExecutable();
      if (
        ["cliPath", "cliSha256", "daemonEndpoint", "image"].some(
          (key) => recheckedConfiguration[key] !== configuration[key],
        )
      )
        throw Error("Isolation configuration changed after consent.");
      cancelled(controller.signal);
      const relationship = path.relative(snapshot.workspaceRoot, this.root);
      if (
        !relationship ||
        (!relationship.startsWith(".." + path.sep) &&
          relationship !== ".." &&
          !path.isAbsolute(relationship))
      )
        throw Error("Quarantine must be outside the project.");
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      await noLinks(this.root, true);
      engineConfig = path.join(this.root, "cli-" + nonce);
      await fs.mkdir(engineConfig, { mode: 0o700 });
      const args = [
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        "dev.sebby.operation=" + nonce,
        "--network=none",
        "--ipc=none",
        "--cgroupns=private",
        "--read-only",
        "--user=65532:65532",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges=true",
        "--pids-limit=64",
        "--memory=512m",
        "--memory-swap=512m",
        "--cpus=1",
        "--ulimit",
        "nofile=128:128",
        "--restart=no",
        "--init",
        "--log-driver=none",
        "--mount",
        `type=bind,src=${snapshot.directory},dst=/input,readonly,bind-propagation=rprivate`,
        "--tmpfs",
        "/work:rw,noexec,nosuid,nodev,size=536870912,mode=1777",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777",
        "--workdir=/work",
        "--entrypoint=/usr/local/bin/node",
        configuration.image,
        "/opt/sebby/runner.mjs",
        "--recipe",
        request.recipe,
        "--snapshot-sha256",
        snapshot.snapshotHash,
        "--lock-sha256",
        snapshot.lockSha256,
      ];
      attempted = true;
      const created = (await invoke(args)).trim();
      if (!/^[a-f0-9]{64}$/.test(created))
        throw Error("Unverified created container ID.");
      id = created;
      await ownership();
      const payload = await invoke(["start", "--attach", id], {
        maximum: 60000,
      });
      await ownership();
      const exit = (await invoke(["wait", id], { maximum: 5000 })).trim();
      if (!/^[0-9]{1,3}$/.test(exit))
        throw Error("Invalid container exit evidence.");
      let document;
      try {
        document = JSON.parse(payload);
      } catch {
        throw Error("Image recipe did not return the audited result protocol.");
      }
      exact(document, [
        "format",
        "recipe",
        "snapshotHash",
        "lockSha256",
        "exitCode",
        "logs",
        "artifacts",
      ]);
      if (
        document.format !== "sebby-isolated-web-v1" ||
        document.recipe !== request.recipe ||
        document.snapshotHash !== snapshot.snapshotHash ||
        document.lockSha256 !== snapshot.lockSha256 ||
        document.exitCode !== Number(exit) ||
        typeof document.logs !== "string" ||
        Buffer.byteLength(document.logs) > 64 * 1024 ||
        !Array.isArray(document.artifacts) ||
        document.artifacts.length > 20
      )
        throw Error("Invalid image result evidence.");
      const files = [],
        seen = new Set();
      let total = 0;
      for (const artifact of document.artifacts) {
        exact(artifact, ["path", "base64", "sha256"]);
        relativeArtifact(artifact.path);
        if (
          seen.has(artifact.path.toLowerCase()) ||
          typeof artifact.base64 !== "string" ||
          artifact.base64.length > 350000
        )
          throw Error("Invalid artifact metadata.");
        seen.add(artifact.path.toLowerCase());
        const bytes = Buffer.from(artifact.base64, "base64");
        if (
          bytes.toString("base64") !== artifact.base64 ||
          bytes.length > 256 * 1024 ||
          hash(bytes) !== artifact.sha256
        )
          throw Error("Invalid artifact bytes/hash.");
        total += bytes.length;
        if (total > 1024 * 1024) throw Error("Artifact limit exceeded.");
        files.push({ path: artifact.path, bytes, sha256: artifact.sha256 });
      }
      cancelled(controller.signal);
      const quarantine = path.join(this.root, "artifacts-" + nonce);
      await fs.mkdir(quarantine, { mode: 0o700 });
      try {
        for (const file of files) {
          cancelled(controller.signal);
          const destination = path.join(quarantine, file.path);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, file.bytes, {
            flag: "wx",
            mode: 0o400,
          });
        }
        cancelled(controller.signal);
      } catch (error) {
        await fs.rm(quarantine, { recursive: true, force: true });
        throw error;
      }
      result = {
        status:
          document.exitCode === 0
            ? "completed-test-double"
            : "failed-test-double",
        operationId: nonce,
        recipe: request.recipe,
        snapshotHash: snapshot.snapshotHash,
        exitCode: document.exitCode,
        logs: document.logs,
        artifacts: {
          directory: quarantine,
          files: files.map((f) => ({
            path: f.path,
            sha256: f.sha256,
            bytes: f.bytes.length,
          })),
          reviewRequired: true,
        },
        nativeExecutionVerified: false,
      };
    } catch (error) {
      result = {
        status: attempted
          ? "uncertain-test-double"
          : controller.signal.aborted
            ? "cancelled-test-double"
            : "blocked-test-double",
        operationId: nonce,
        error: controller.signal.aborted
          ? "cancelled"
          : "validation-or-transport-failed",
        nativeExecutionVerified: false,
      };
    } finally {
      if (id) {
        try {
          await ownership(true);
          await invoke(["rm", "--force", id], { cleanup: true, maximum: 5000 });
          cleanupVerified = true;
        } catch {
          result = {
            ...result,
            status: "uncertain-test-double",
            cleanupRequired: true,
          };
        }
      } else if (attempted)
        result = {
          ...result,
          status: "uncertain-test-double",
          cleanupRequired: true,
        };
      if (engineConfig) {
        try {
          await fs.rm(engineConfig, { recursive: true, force: true });
        } catch {
          result = {
            ...result,
            status: "uncertain-test-double",
            cleanupRequired: true,
          };
        }
      }
      request.signal?.removeEventListener("abort", abort);
      this.controller = null;
      this.active = false;
    }
    return { ...result, cleanupVerified, containerId: id, ownedName: name };
  }
}
