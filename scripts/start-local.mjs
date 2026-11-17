// Portable provider-free launcher. npm supplies its own CLI path, including on Windows.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
let active, stopping = false;
const stop = () => { stopping = true; if (active && active.exitCode === null) { active.kill('SIGTERM'); const force = setTimeout(() => active?.kill('SIGKILL'), 5000); force.unref(); } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
// Optional parent supervision for a future desktop shell and acceptance tests.
if (process.send) { process.on('message', value => { if (value === 'shutdown') stop(); }); process.on('disconnect', stop); }
function run(args, env = process.env) {
  return new Promise((resolve, reject) => {
    if (stopping) return reject(new Error('Startup cancelled'));
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' }); active = child;
    child.once('error', reject);
    child.once('close', code => { if (active === child) active = undefined; code === 0 || stopping ? resolve() : reject(new Error(`Command exited with code ${code}`)); });
  });
}
async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) if (!['--check', '--no-open', '--no-install', '--no-build', '--prebuilt'].includes(flag) && !/^--port=\d+$/.test(flag)) throw new Error('Use npm run local -- [--check] [--no-open] [--port=8787].');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 12) throw new Error('Install Node.js 22.12 or newer from https://nodejs.org/en/download. Node 22 is tested by CI.');
  const prebuilt = flags.has('--prebuilt');
  const npm = process.env.npm_execpath;
  if (!prebuilt && (!npm || !existsSync(npm))) throw new Error('Start with npm run local (Windows: npm.cmd run local), or double-click Start-Sebby.cmd.');
  let git;
  try { git = execFileSync('git', ['--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch {
    if (!prebuilt) throw new Error('Install Git from https://git-scm.com/downloads/win, then reopen the terminal.');
    git = null;
  }
  const portFlags = [...flags].filter(f => f.startsWith('--port='));
  if (portFlags.length > 1) throw new Error('Choose one local port.');
  const port = Number(portFlags[0]?.slice(7) ?? process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer between 1 and 65535.');
  const marker = path.join(root, 'node_modules', '.sebby-local-install');
  let installKey, installed = prebuilt;
  if (!prebuilt) {
    const dependencyHash = createHash('sha256');
    for (const file of ['package-lock.json', 'package.json', 'server/package.json', 'web/package.json']) dependencyHash.update(file).update(readFileSync(path.join(root, file)));
    installKey = [process.platform, process.arch, process.versions.modules, dependencyHash.digest('hex')].join(':');
    try { installed = readFileSync(marker, 'utf8') === installKey; } catch {}
  }
  const buildReady = () => ['server/dist/workspace-server.js', 'web/dist/index.html'].every(file => existsSync(path.join(root, file)));
  if (prebuilt && !buildReady()) throw new Error('Package files are missing. Extract the entire Sebby test ZIP again.');
  if (flags.has('--check')) { console.log(JSON.stringify({ node: process.versions.node, git, root, url: `http://127.0.0.1:${port}/workspace`, installNeeded: !installed, mode: 'workspace', liveAgents: false }, null, 2)); return; }
  // Do not open a browser to an unrelated service already using Sebby's port.
  await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the other server or use --port=8788.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  if (!installed && !flags.has('--no-install')) {
    console.log('Installing the locked Sebby dependencies...');
    await run([npm, 'ci']); if (stopping) return;
    writeFileSync(marker, installKey, { mode: 0o600 });
  }
  if (!prebuilt && !flags.has('--no-build')) { console.log('Building Sebby...'); await run([npm, 'run', 'build']); if (stopping) return; }
  if (!buildReady()) throw new Error('Build files are missing. Run npm run local without --no-build.');
  const base = `http://127.0.0.1:${port}`;
  console.log('Starting the local workspace. Live AI engines and Google authorization require separate configuration.');
  const finished = run(['--env-file-if-exists=.env.local', 'server/dist/workspace-server.js'], { ...process.env, PORT: String(port), APP_URL: base, SEBBY_WORKSPACE_ONLY: '1', DEV_LOGIN: '1', SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex') });
  let startupError; void finished.catch(error => { startupError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 150 && !stopping && !startupError && active; attempt++) {
    try { const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(800) }); const status = await response.json(); if (response.ok && status.mode === 'workspace' && status.agents === false) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready && !stopping) { stop(); await finished; throw startupError || new Error('Sebby did not become ready. Read the server output above.'); }
  if (ready) {
    const url = base + '/workspace'; console.log(`Sebby local ready: ${url}`);
    console.log('Keep this window open. Save project edits explicitly; press Ctrl+C here to stop.');
    if (!flags.has('--no-open')) {
      const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/d', '/c', 'start', url] : [url];
      const browser = spawn(command, args, { stdio: 'ignore', detached: true }); browser.once('error', () => console.log(`Open ${url} in your browser.`)); browser.unref();
    }
  }
  await finished;
}
main().catch(error => { console.error('Sebby: ' + error.message); process.exitCode = 1; }).finally(() => { if (process.connected) process.disconnect(); });
