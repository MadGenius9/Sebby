import { createHash } from "node:crypto";
import path from "node:path";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import { documentSchema, type SourceImportReview } from "./schema.js";

export const SOURCE_IMPORT_LIMITS = {
  upload: 4_000_000,
  entries: 512,
  files: 40,
  fileBytes: 100_000,
  totalBytes: 600_000,
};
const ignoredFolders = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  "__macosx",
]);
const textExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".py",
  ".rs",
  ".go",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".java",
  ".sh",
  ".sql",
  ".svelte",
  ".vue",
  ".glsl",
  ".wgsl",
]);
const textNames = new Set([
  "dockerfile",
  "makefile",
  "license",
  "readme",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
]);
function safeArchivePath(value: string) {
  const clean = value.endsWith("/") ? value.slice(0, -1) : value;
  return (
    clean.length > 0 &&
    clean.length <= 240 &&
    clean.split("/").length <= 16 &&
    clean
      .split("/")
      .every(
        (s) =>
          /^[a-zA-Z0-9_@. -]+$/.test(s) &&
          s !== "." &&
          s !== ".." &&
          !/[. ]$/.test(s) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
      )
  );
}
function exclusion(value: string) {
  const parts = value.toLowerCase().split("/"),
    name = parts.at(-1)!;
  if (parts.some((s) => ignoredFolders.has(s)))
    return "Generated files, dependencies or repository metadata";
  if (
    /^\.env(?:\.|$)/.test(name) ||
    [
      ".npmrc",
      ".pypirc",
      ".netrc",
      "credentials.json",
      "service-account.json",
      "id_rsa",
      "id_ed25519",
    ].includes(name) ||
    /\.(?:pem|key|p12|pfx|keystore)$/.test(name)
  )
    return "Potential credentials or local configuration";
  if (!textExtensions.has(path.posix.extname(name)) && !textNames.has(name))
    return "Binary or unsupported source format";
  return null;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Files remain in bounded memory. No archive path is written to the host filesystem.
export async function reviewSourceZip(
  buffer: Buffer,
  name: string,
  stripRoot: boolean,
): Promise<SourceImportReview> {
  if (!buffer.length || buffer.length > SOURCE_IMPORT_LIMITS.upload)
    throw new Error("Source ZIP must be between 1 byte and 4 MB");
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      buffer,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
  if (zip.entryCount > SOURCE_IMPORT_LIMITS.entries) {
    zip.close();
    throw new Error("ZIP exceeds 512 entries");
  }
  const files: { path: string; content: string }[] = [],
    skipped: { path: string; reason: string }[] = [],
    seen = new Map<string, boolean>();
  let entries = 0,
    totalBytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error("Source ZIP inspection timed out")),
        10000,
      );
      const finish = () => {
        clearTimeout(timer);
      };
      zip.on("error", (error) => {
        finish();
        fail(error);
      });
      zip.on("end", () => {
        finish();
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          if (settled) return;
          if (++entries > SOURCE_IMPORT_LIMITS.entries)
            throw new Error("ZIP exceeds 512 entries");
          const value = entry.fileName,
            directory = value.endsWith("/"),
            key = (directory ? value.slice(0, -1) : value).toLowerCase();
          if (!safeArchivePath(value))
            throw new Error("ZIP contains an unsafe or unsupported path");
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== (directory ? 0x4000 : 0x8000))
            throw new Error("ZIP links and special files are not supported");
          if (entry.generalPurposeBitFlag & 1)
            throw new Error("Encrypted ZIP files are not supported");
          if (seen.has(key))
            throw new Error("ZIP contains duplicate or case-colliding paths");
          seen.set(key, directory);
          for (const [other, isDirectory] of seen) {
            if (other === key) continue;
            if (
              (key.startsWith(other + "/") && !isDirectory) ||
              (other.startsWith(key + "/") && !directory)
            )
              throw new Error("ZIP file and directory paths overlap");
          }
          if (directory) {
            zip.readEntry();
            return;
          }
          const reason = exclusion(value);
          if (reason) {
            skipped.push({ path: value, reason });
            zip.readEntry();
            return;
          }
          if (files.length >= SOURCE_IMPORT_LIMITS.files)
            throw new Error(
              "Import exceeds 40 source files; make a smaller source ZIP",
            );
          if (
            entry.uncompressedSize > SOURCE_IMPORT_LIMITS.fileBytes ||
            totalBytes + entry.uncompressedSize >
              SOURCE_IMPORT_LIMITS.totalBytes
          )
            throw new Error(
              "Source exceeds the 100 KB per file or 600 KB total limit",
            );
          const stream = await new Promise<import("node:stream").Readable>(
            (resolve, reject) =>
              zip.openReadStream(entry, (error, value) =>
                error ? reject(error) : resolve(value),
              ),
          );
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of stream) {
            if (settled) {
              stream.destroy();
              return;
            }
            bytes += chunk.length;
            if (
              bytes > SOURCE_IMPORT_LIMITS.fileBytes ||
              totalBytes + bytes > SOURCE_IMPORT_LIMITS.totalBytes
            ) {
              stream.destroy();
              throw new Error("Expanded source exceeds import limits");
            }
            chunks.push(chunk);
          }
          const data = Buffer.concat(chunks);
          if (
            data.length !== entry.uncompressedSize ||
            crc32(data) !== entry.crc32
          )
            throw new Error("ZIP content integrity check failed");
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(data);
          } catch {
            throw new Error("Source files must contain valid UTF-8 text");
          }
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content))
            throw new Error("Source file contains binary control characters");
          totalBytes += bytes;
          files.push({ path: value, content });
          zip.readEntry();
        })().catch((error) => {
          finish();
          fail(
            error instanceof Error ? error : new Error("Could not inspect ZIP"),
          );
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  if (!files.length)
    throw new Error("No supported source files remain after filtering");
  const prefix = files[0].path.split("/")[0] + "/";
  const sourceRoot =
    stripRoot && files.every((f) => f.path.startsWith(prefix)) ? prefix : "";
  const document = documentSchema.parse({
    name,
    files: files.map((f) => ({ ...f, path: f.path.slice(sourceRoot.length) })),
    scene: { objects: [] },
  });
  // The existing project endpoint is also used for reviewed imports; keep its JSON limit.
  if (Buffer.byteLength(JSON.stringify(document)) > 900_000)
    throw new Error(
      "Source text exceeds the project request limit after JSON encoding",
    );
  return {
    document,
    archiveSha256: createHash("sha256").update(buffer).digest("hex"),
    sourceRoot,
    totalBytes,
    skipped,
    warnings: [
      "Review source before running it. Filename filtering does not detect every secret.",
      "Images, other binary assets and Git history are not imported. Dependencies are not installed.",
    ],
  };
}
