import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url)), launcher = path.join(root, 'scripts/start-local.mjs');
const packageRoot = process.env.SEBBY_WINDOWS_TEST_ROOT;
const runtime = packageRoot ? path.join(packageRoot, 'runtime', 'node.exe') : process.execPath;
const serverLauncher = packageRoot ? path.join(packageRoot, 'scripts', 'start-local.mjs') : launcher;
const startFlags = packageRoot ? ['--prebuilt'] : ['--no-install', '--no-build'];
const testEnv = { ...process.env };
if (packageRoot) {
  delete testEnv.npm_execpath;
  for (const key of Object.keys(testEnv)) if (key.toLowerCase() === 'path') delete testEnv[key];
  testEnv.Path = path.join(process.env.SystemRoot, 'System32');
}
const invoke = (args, options = {}) => exec(process.execPath, [launcher, ...args], { cwd: os.tmpdir(), timeout: 15000, ...options });
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('local readiness checks work outside the repository without starting or modifying a database', { skip: !!packageRoot }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sebby-launcher-check-')), db = path.join(directory, 'absent.db');
  try {
    const { stdout } = await invoke(['--check'], { env: { ...process.env, DB_PATH: db } }), info = JSON.parse(stdout);
    assert.equal(info.mode, 'workspace'); assert.equal(info.liveAgents, false); assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/workspace$/); assert.match(info.git, /^git version/); assert.equal(path.resolve(info.root), path.resolve(root));
    await assert.rejects(access(db));
    for (const arg of ['--port=0', '--port=99999', '--unexpected']) await assert.rejects(invoke(['--check', arg]));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local startup refuses an occupied port before installing or opening a different service', { skip: !!packageRoot }, async () => {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(invoke(['--no-install', '--no-build', '--no-open', '--port=' + listener.address().port]), error => /already in use/.test(error.stderr)); }
  finally { await new Promise(resolve => listener.close(resolve)); }
});

test('real launcher starts on loopback, preserves saved projects across restarts and stops its child server', { timeout: 40000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sebby launcher data ')), port = await freePort(), base = `http://127.0.0.1:${port}`;
  async function start() {
    const child = fork(serverLauncher, [...startFlags, '--no-open', '--port=' + port], {
      execPath: runtime, cwd: os.tmpdir(), silent: true,
      env: { ...testEnv, DB_PATH: packageRoot ? undefined : path.join(directory, 'workspace.db'), SEBBY_RUNS_DIR: path.join(directory, 'runs') },
    });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const closed = once(child, 'exit');
    async function stop() {
      if (child.connected) child.send('shutdown');
      const timer = setTimeout(() => child.kill(), 7000);
      try { const [code] = await closed; assert.equal(code, 0, output); } finally { clearTimeout(timer); }
    }
    try {
      const deadline = Date.now() + 15000;
      while (!output.includes('Sebby local ready:') && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 50));
      assert.match(output, /Sebby local ready:/); assert.equal(child.exitCode, null);
      assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true, mode: 'workspace', agents: false });
      return { child, stop };
    } catch (error) { await stop(); throw error; }
  }
  let running;
  try {
    running = await start();
    const page = await fetch(base + '/workspace');
    assert.equal(page.status, 200);
    const bundlePath = (await page.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(bundlePath, 'Workspace HTML references a built script');
    const bundle = await fetch(base + bundlePath);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type'), /javascript/);
    await bundle.body.cancel();
    const login = await fetch(base + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'launcher@example.test' }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0], headers = { cookie, origin: base, 'content-type': 'application/json' };
    const created = await fetch(base + '/api/projects', { method: 'POST', headers, body: JSON.stringify({ name: 'Launcher persistence', template: 'web' }) }); assert.equal(created.status, 201); const { project } = await created.json();
    await running.stop(); running = undefined;
    if (packageRoot) await access(path.join(packageRoot, 'data', 'grokbot.db'));
    await assert.rejects(fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) }));
    running = await start();
    const reopened = await fetch(base + '/api/projects/' + project.id, { headers }); assert.equal(reopened.status, 200); assert.equal((await reopened.json()).project.name, 'Launcher persistence');
  } finally { if (running) await running.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('Windows double-click wrapper runs its read-only check from a path containing spaces', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sebby windows ')), linked = path.join(directory, 'Sebby workspace');
  try {
    if (!packageRoot) await symlink(root, linked, 'junction');
    const { stdout } = await exec('cmd.exe', ['/d', '/s', '/c', 'Start-Sebby.cmd --check'], { cwd: packageRoot || linked, env: { ...testEnv, npm_config_loglevel: 'silent', SEBBY_LAUNCHER_NO_PAUSE: '1' }, timeout: 15000 });
    const info = JSON.parse(stdout);
    assert.equal(info.mode, 'workspace'); assert.equal(info.liveAgents, false);
    if (packageRoot) {
      assert.match(info.root, /Sebby Windows Test/);
      assert.equal(info.git, null);
      assert.equal(info.installNeeded, false);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
