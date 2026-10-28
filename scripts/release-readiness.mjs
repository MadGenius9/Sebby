import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const EXPECTED_FILES = [
  "dist/**/*",
  "electron/**/*",
  "skills/**/*",
  "package.json",
  "docs/THIRD-PARTY-NOTICES.md",
];
const SOURCE_ROOTS = [
  "src",
  "electron",
  "skills",
  "public",
  "build",
  "scripts",
  "native/windows-job-runner",
];
const SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const forbidden = (relative) =>
  relative
    .split("/")
    .some(
      (part) =>
        part.startsWith(".") ||
        /^(?:sebby-.*(?:vault|state|tasks|conversations|reminders|profiles)|node_modules|tests?|fixtures?|tmp|temp|coverage)$/i.test(
          part,
        ),
    ) ||
  /\.(?:credential|pem|pfx|p12|key|log|tmp)$/i.test(relative) ||
  /(?:^|\/)(?:sebby-(?:state|tasks|skills|team|appearance|reminders|conversations|connectors|provider-profiles)|provider-vault|credentials)\.json$/i.test(
    relative,
  );
function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || part.startsWith("."),
      )
  )
    throw Error("Only non-hidden workspace-relative paths are accepted.");
  return value;
}
async function regular(root, relative, { missing = false } = {}) {
  safeRelative(relative);
  let current = root;
  try {
    for (const [i, part] of relative.split("/").entries()) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw Error(`Linked paths are not read: ${relative}`);
      if (i === relative.split("/").length - 1) {
        if (!stat.isFile()) throw Error(`Not a regular file: ${relative}`);
        if (stat.size > 32 * 1024 * 1024)
          throw Error(`File too large for inventory: ${relative}`);
        return stat;
      }
      if (!stat.isDirectory()) throw Error("Invalid path parent.");
    }
  } catch (error) {
    if (missing && error.code === "ENOENT") return null;
    throw error;
  }
}
async function bytesAt(root, relative, options) {
  const stat = await regular(root, relative, options);
  return stat ? fs.readFile(path.join(root, relative)) : null;
}
async function metadata(root, relative) {
  const data = await bytesAt(root, relative);
  return { path: relative, bytes: data.length, sha256: sha(data) };
}
async function walk(root, relative, findings, { packaging = false } = {}) {
  safeRelative(relative);
  for (let i = 1; i < relative.split("/").length; i++) {
    const parent = relative.split("/").slice(0, i).join("/");
    let stat;
    try {
      stat = await fs.lstat(path.join(root, parent));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      findings.push({ path: parent, reason: "unsafe-parent-not-followed" });
      return [];
    }
  }
  const output = [];
  let count = 0;
  async function visit(current) {
    let stat;
    try {
      stat = await fs.lstat(path.join(root, current));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      findings.push({ path: current, reason: "symlink-not-followed" });
      return;
    }
    if (packaging && forbidden(current)) {
      findings.push({
        path: current,
        reason: "forbidden-package-path-not-read",
      });
      return;
    }
    if (current.split("/").some((part) => part.startsWith("."))) return;
    if (++count > 5000) throw Error("Inventory entry limit exceeded.");
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(path.join(root, current))).sort())
        await visit(`${current}/${entry}`);
    } else if (stat.isFile()) {
      if (forbidden(current)) {
        findings.push({
          path: current,
          reason: "sensitive-or-generated-source-not-read",
        });
        return;
      }
      output.push(await metadata(root, current));
    }
  }
  await visit(relative);
  return output;
}
function packagePath(value) {
  return (
    /^node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+(?:\/node_modules\/(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+)*$/.test(
      value,
    ) && !value.split("/").some((x) => x.startsWith("."))
  );
}
async function packageLicense(root, relative, expectedVersion) {
  const raw = await bytesAt(root, `${relative}/package.json`),
    pkg = JSON.parse(raw);
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string")
    throw Error("Invalid installed package metadata.");
  const files = [];
  for (const entry of (await fs.readdir(path.join(root, relative))).sort()) {
    if (
      /^(?:licen[sc]e|copying|notice)(?:[._-].*)?$/i.test(entry) &&
      !entry.startsWith(".")
    ) {
      const stat = await fs.lstat(path.join(root, relative, entry));
      if (stat.isFile() && !stat.isSymbolicLink())
        files.push(await metadata(root, `${relative}/${entry}`));
    }
  }
  return {
    name: pkg.name,
    version: pkg.version,
    installedPath: relative,
    declaredLicense:
      typeof pkg.license === "string"
        ? pkg.license
        : (pkg.license?.type ?? null),
    licenseFiles: files,
    packageMetadataSha256: sha(raw),
    lockVersionMatches: expectedVersion === pkg.version,
  };
}
export async function collectReadiness(directory) {
  const root = path.resolve(directory),
    rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw Error("Select a real workspace directory.");
  const packageBytes = await bytesAt(root, "package.json"),
    lockBytes = await bytesAt(root, "package-lock.json");
  const pkg = JSON.parse(packageBytes),
    lock = JSON.parse(lockBytes);
  if (
    !lock.packages ||
    typeof lock.packages !== "object" ||
    Array.isArray(lock.packages)
  )
    throw Error("A package-lock with package entries is required.");
  const issues = [],
    source = [],
    packageFiles = [],
    dependencies = [];
  for (const relative of SOURCE_FILES)
    if (await regular(root, relative, { missing: true }))
      source.push(await metadata(root, relative));
  for (const relative of SOURCE_ROOTS)
    source.push(...(await walk(root, relative, issues)));
  const declaredPatterns = pkg.build?.files;
  const patternsSafe =
    Array.isArray(declaredPatterns) &&
    declaredPatterns.length === EXPECTED_FILES.length &&
    EXPECTED_FILES.every((p) => declaredPatterns.includes(p));
  if (!patternsSafe)
    issues.push({
      path: "package.json#build.files",
      reason: "packaging-allowlist-differs-from-reviewed-explicit-list",
    });
  for (const key of [
    "extraFiles",
    "extraResources",
    "afterPack",
    "beforePack",
    "afterSign",
    "afterAllArtifactBuild",
    "electronDist",
  ])
    if (pkg.build?.[key] !== undefined)
      issues.push({
        path: `package.json#build.${key}`,
        reason: "unreviewed-packaging-extension",
      });
  for (const directory of ["dist", "electron", "skills"])
    packageFiles.push(
      ...(await walk(root, directory, issues, { packaging: true })),
    );
  packageFiles.push(await metadata(root, "package.json"));
  for (const [relative, entry] of Object.entries(lock.packages).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (!relative || entry.dev === true || entry.devOptional === true) continue;
    if (!packagePath(relative)) {
      issues.push({
        path: "package-lock.json",
        reason: "invalid-production-package-path",
      });
      continue;
    }
    try {
      const license = await packageLicense(root, relative, entry.version);
      dependencies.push(license);
      if (!license.lockVersionMatches)
        issues.push({
          path: relative,
          reason: "installed-version-does-not-match-lock",
        });
      if (!license.declaredLicense || !license.licenseFiles.length)
        issues.push({
          path: relative,
          reason: "license-metadata-or-text-missing",
        });
    } catch {
      issues.push({
        path: relative,
        reason: "installed-production-package-or-license-unavailable",
      });
    }
  }
  for (const name of Object.keys(pkg.dependencies ?? {}).sort())
    if (
      !dependencies.some(
        (item) => item.installedPath === `node_modules/${name}`,
      )
    )
      issues.push({
        path: `node_modules/${name}`,
        reason: "direct-production-dependency-not-in-inventory",
      });
  let electron = null;
  try {
    electron = await packageLicense(
      root,
      "node_modules/electron",
      lock.packages["node_modules/electron"]?.version,
    );
  } catch {
    issues.push({
      path: "node_modules/electron",
      reason: "electron-wrapper-metadata-unavailable",
    });
  }
  const windowsBinary = await regular(
    root,
    "node_modules/electron/dist/electron.exe",
    { missing: true },
  );
  const chromiumNotices = await regular(
    root,
    "node_modules/electron/dist/LICENSES.chromium.html",
    { missing: true },
  );
  const electronRuntimeLicense = await regular(
    root,
    "node_modules/electron/dist/LICENSE",
    { missing: true },
  );
  const notices = await bytesAt(root, "docs/THIRD-PARTY-NOTICES.md", {
    missing: true,
  });
  const noticesIncluded = Boolean(
    notices &&
    Array.isArray(declaredPatterns) &&
    declaredPatterns.includes("docs/THIRD-PARTY-NOTICES.md"),
  );
  if (noticesIncluded)
    packageFiles.push(await metadata(root, "docs/THIRD-PARTY-NOTICES.md"));
  const checks = [
    {
      id: "packaging-source-policy",
      status: issues.length ? "blocked" : "pass",
      details:
        "Reviewed explicit app patterns; production node_modules remain automatically included by electron-builder. No artifact exists to audit.",
    },
    {
      id: "private-source-repository",
      status: pkg.private === true ? "pass" : "blocked",
      details:
        "package.private protects accidental npm publication, not GitHub visibility or installer distribution.",
    },
    {
      id: "built-renderer",
      status: packageFiles.some((x) => x.path === "dist/index.html")
        ? "pass"
        : "blocked",
      details: "Presence/hash only; does not prove GUI or freshness.",
    },
    {
      id: "windows-electron-runtime-present",
      status: windowsBinary ? "present-unverified" : "blocked",
      details: "No runtime is downloaded or executed by this script.",
    },
    {
      id: "runtime-notices-present",
      status:
        chromiumNotices && electronRuntimeLicense
          ? "present-unreviewed"
          : "blocked",
      details:
        "Electron/Chromium/transitive runtime notices still need exact artifact review.",
    },
    {
      id: "notices-packaging-declaration",
      status: noticesIncluded ? "pass" : "blocked",
      details:
        "Exact notices file exists and is explicitly included in build.files; this source evidence does not prove presence in a built ASAR/installer or legal completeness.",
    },
    {
      id: "curated-third-party-notices",
      status: notices ? "present-unreviewed" : "blocked",
      details:
        "Notice inventory is not legal clearance; ensure the final artifact actually carries required notices.",
    },
    {
      id: "windows-native-validation",
      status: "not-verified",
      details:
        "No Windows installer/process/voice/vault/helper tests inferred from source.",
    },
    {
      id: "signing-and-distribution",
      status: "not-authorized",
      details:
        "No signing key, installer, publication or app-store submission performed.",
    },
  ];
  return {
    schemaVersion: 1,
    project: {
      name: pkg.name,
      version: pkg.version,
      private: pkg.private === true,
    },
    packageJsonSha256: sha(packageBytes),
    lockfileSha256: sha(lockBytes),
    source: source.sort((a, b) => a.path.localeCompare(b.path)),
    packaging: {
      reviewedPatterns: EXPECTED_FILES,
      declaredPatterns: declaredPatterns ?? null,
      autoIncludedProductionDependencies: true,
      candidateFiles: packageFiles.sort((a, b) => a.path.localeCompare(b.path)),
      findings: issues,
    },
    productionDependencies: dependencies,
    electron: {
      wrapper: electron,
      windowsBinaryPresent: !!windowsBinary,
      runtimeLicensePresent: !!electronRuntimeLicense,
      chromiumNoticesPresent: !!chromiumNotices,
    },
    curatedNoticesSha256: notices ? sha(notices) : null,
    checks,
    readyForPublicDistribution: false,
    limitations: [
      "Deterministic code/config/dependency snapshot, not a built-artifact audit or secret-content scanner.",
      "Hidden/sensitive named paths are not read; findings identify names only.",
      "No network, subprocess, signing, credential, install or publication operation is performed.",
    ],
  };
}
export async function writeManifest(directory, relative, manifest) {
  const root = path.resolve(directory);
  safeRelative(relative);
  if (
    SOURCE_ROOTS.some(
      (source) => relative === source || relative.startsWith(source + "/"),
    ) ||
    SOURCE_FILES.includes(relative)
  )
    throw Error("Output cannot modify an inventoried source tree.");
  if (forbidden(relative) || !relative.endsWith(".json"))
    throw Error("Choose a non-sensitive workspace-relative .json output.");
  const parent = path.dirname(relative);
  if (parent !== ".") {
    let current = root;
    for (const part of parent.split("/")) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("Output parent must be an existing real directory.");
    }
  }
  const target = path.join(root, relative);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error("Output must be a regular non-linked file.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.writeFile(target, JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd(),
    output = null,
    check = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === "--root") root = args.shift() ?? "";
    else if (arg === "--output") output = args.shift() ?? "";
    else if (arg === "--check") check = true;
    else
      throw Error(
        "Usage: node scripts/release-readiness.mjs [--root workspace] [--output relative/file.json] [--check]",
      );
  }
  const result = await collectReadiness(root);
  if (output) await writeManifest(root, output, result);
  else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (check && result.checks.some((item) => item.status !== "pass"))
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch(() => {
    process.stderr.write(
      "Release readiness failed safely. Check workspace inputs/output path; no packaging or publication was attempted.\n",
    );
    process.exitCode = 2;
  });
