// Produce a minimal build context from a project export. Does not run npm or Docker.
import fs from "node:fs/promises";
import path from "node:path";
import { documentSchema } from "../server/src/workspace/schema.js";
import { dependencyFingerprint } from "../server/src/workspace/dependencies.js";
const [source, target, ...extra] = process.argv.slice(2);
if (!source || !target || extra.length)
  throw new Error(
    "Usage: node --import tsx scripts/prepare-dependencies.mts exported-project.json NEW_OUTPUT_DIRECTORY",
  );
const stat = await fs.stat(source);
if (stat.size > 1000000) throw new Error("Project export exceeds 1 MB");
const raw = JSON.parse(await fs.readFile(source, "utf8"));
const document = documentSchema.parse({
  name: raw.name,
  files: raw.files,
  scene: raw.scene,
});
const lockHash = dependencyFingerprint(document);
if (!lockHash)
  throw new Error(
    "This project has no dependencies; use the base runner image.",
  );
const output = path.resolve(target);
await fs.mkdir(output, { mode: 0o700 });
for (const name of ["package.json", "package-lock.json"])
  await fs.writeFile(
    path.join(output, name),
    document.files.find((f) => f.path === name)!.content,
    { flag: "wx", mode: 0o600 },
  );
await fs.copyFile(
  new URL(
    "../server/runner-images/npm-dependencies.Dockerfile",
    import.meta.url,
  ),
  path.join(output, "Dockerfile"),
);
await fs.writeFile(
  path.join(output, "profile.json"),
  JSON.stringify({ lockHash }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify(
    {
      lockHash,
      context: output,
      files: [
        "package.json",
        "package-lock.json",
        "Dockerfile",
        "profile.json",
      ],
      imageBuilt: false,
    },
    null,
    2,
  ),
);
