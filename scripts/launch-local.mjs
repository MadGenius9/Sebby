import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli))
  throw Error("Use npm run launch:local or Launch-Sebby.cmd.");
async function available() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/version", {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
if (!(await available())) {
  const ollama = path.join(
    process.env.LOCALAPPDATA || "",
    "Programs",
    "Ollama",
    "ollama.exe",
  );
  if (!fs.existsSync(ollama))
    throw Error(
      "Install Ollama from https://ollama.com/download/windows first.",
    );
  const server = spawn(ollama, ["serve"], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  server.unref();
  const deadline = Date.now() + 30000;
  while (!(await available())) {
    if (Date.now() > deadline)
      throw Error("Ollama did not start within 30 seconds.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
// Start an explicitly installed local voice runtime. Never install/download here.
const voiceRoot = path.join(
  process.env.LOCALAPPDATA || "",
  "Sebby",
  "local-voice",
);
const voicePython = path.join(voiceRoot, "venv", "Scripts", "python.exe");
const voiceServer = path.join(root, "native", "local-voice", "server.py");
if (
  fs.existsSync(voicePython) &&
  fs.existsSync(voiceServer) &&
  fs.existsSync(path.join(voiceRoot, "models", "kokoro-v1.0.onnx"))
) {
  let running = false;
  try {
    running = (
      await fetch("http://127.0.0.1:11435/health", {
        signal: AbortSignal.timeout(1500),
      })
    ).ok;
  } catch {
    /* Start installed service below. */
  }
  if (!running) {
    const voice = spawn(
      voicePython,
      [voiceServer, "--assets", path.join(voiceRoot, "models")],
      {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      },
    );
    voice.on("error", () =>
      console.warn(
        "Local voice service could not start. Sebby will show its availability.",
      ),
    );
    voice.unref();
  }
}
// No models, accounts, profile selection or cloud requests are changed here.
const build = spawn(process.execPath, [npmCli, "run", "build"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
const built = await new Promise((resolve) => {
  build.on("error", () => resolve(false));
  build.on("exit", (code) => resolve(code === 0));
});
if (!built) process.exit(1);
const electron = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const desktop = spawn(electron, [root], {
  cwd: root,
  detached: true,
  stdio: "ignore",
});
desktop.on("error", (error) => {
  console.error(`Sebby could not launch: ${error.message}`);
  process.exitCode = 1;
});
desktop.unref();
