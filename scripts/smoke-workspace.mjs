// Exercises the built local-only server over real HTTP with disposable test data.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(tmpdir(), 'sebby-http-'));
const port = String(20000 + Math.floor(Math.random() * 30000));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['scripts/workspace-local.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: port, DB_PATH: path.join(root, 'workspace.db'), SEBBY_RUNS_DIR: path.join(root, 'runs'), SEBBY_RUNNER_IMAGE: '' },
});
let logs = '';
let started;
const ready = new Promise((resolve, reject) => {
  started = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 10000);
  child.stdout.on('data', b => { logs += b; if (logs.includes('Sebby workspace:')) resolve(); });
  child.stderr.on('data', b => { logs += b; });
  child.once('error', reject);
  child.once('exit', code => reject(new Error(`Server exited (${code}): ${logs}`)));
});
const exited = new Promise(resolve => child.once('exit', resolve));
try {
  await ready; clearTimeout(started);
  const page = await fetch(`${base}/workspace`); assert.equal(page.status, 200);
  const html = await page.text(); assert.match(html, /<title>Sebby<\/title>/);
  const bundle = html.match(/src="([^"]+\.js)"/)[1]; assert.equal((await fetch(new URL(bundle, base))).status, 200);
  const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.mode, 'workspace');
  const login = await fetch(`${base}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'http-smoke@example.test' }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', origin: base };
  const created = await fetch(`${base}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'HTTP smoke', template: 'web' }) }); assert.equal(created.status, 201);
  const { project } = await created.json(); assert.equal(project.files.length, 6);
  const preview = await (await fetch(`${base}/api/projects/${project.id}/preview`, { headers })).json(); assert.match(preview.html, /Made with Sebby/); assert.equal(preview.revision, 1);
  const history = await (await fetch(`${base}/api/projects/${project.id}/revisions`, { headers })).json(); assert.equal(history.revisions[0].revision, 1);
  const runtime = await (await fetch(`${base}/api/workspace/runtime`, { headers })).json(); assert.equal(runtime.available, false);
  const run = await fetch(`${base}/api/workspace/${project.id}/runs`, { method: 'POST', headers, body: JSON.stringify({ revision: 1, command: 'test' }) }); assert.equal(run.status, 503);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/preview`)).status, 401);
  console.log('HTTP smoke passed: entry/bundle, local session, project, preview, history, unavailable-worker refusal and unauthenticated access.');
} finally {
  clearTimeout(started); child.kill('SIGTERM');
  const killed = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited; clearTimeout(killed); await rm(root, { recursive: true, force: true });
}
