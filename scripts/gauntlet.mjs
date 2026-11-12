import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli))
  throw Error("Run this with npm run gauntlet.");
const stages = [
  ["Service and failure-path tests", ["test"]],
  ["Interface and workflow tests", ["run", "test:components"]],
  ["Typecheck and production build", ["run", "build"]],
  ["Formatting", ["run", "format:check"]],
];
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  stages: [],
  limits: [
    "No live provider/model inference",
    "No Windows native validation",
    "No browser visual certification",
  ],
};
const destination = path.join(root, ".gauntlet");
await fs.mkdir(destination, { recursive: true });
for (const [name, args] of stages) {
  process.stdout.write(`\nGauntlet: ${name}\n`);
  const started = Date.now();
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  report.stages.push({ name, exitCode, milliseconds: Date.now() - started });
  if (exitCode !== 0) {
    report.status = "failed";
    process.exitCode = 1;
    break;
  }
}
if (report.status === "running") report.status = "passed";
await fs.writeFile(
  path.join(destination, "latest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(
  `\nGauntlet ${report.status}. Evidence: .gauntlet/latest.json\nLive model, Windows and visual checks remain separate.\n`,
);
