import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(path.join(tmpdir(), 'sebby-test-'));
process.env.SEBBY_WORKSPACE_ONLY = '1';
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(dir, 'workspace.db');
const { db } = await import('../server/src/db.js');
const { projectsApi } = await import('../server/src/workspace/projects.js');
for (const id of ['alice', 'bob']) {
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(id, `${id}@example.test`, id, Date.now());
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(id, id, Date.now(), Date.now()+60000);
}
const call = (method: string, url: string, user = 'alice', body?: unknown, origin?: string) => projectsApi.request(`http://localhost${url}`, { method, headers: { cookie: `grokbot_session=${user}`, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

test('project workflow persists source and transforms with ownership and conflict protection', async () => {
  assert.equal((await call('GET', '/', '')).status, 401);
  const created = await call('POST', '/', 'alice', { name: 'Sebby test' });
  assert.equal(created.status, 201);
  const { project } = await created.json();
  assert.equal(project.files[0].path, 'README.md');
  assert.equal((await call('GET', `/${project.id}`, 'bob')).status, 404);
  const bobList = await (await call('GET', '/', 'bob')).json();
  assert.equal(bobList.projects.length, 0);
  const body = { name: project.name, revision: project.revision, files: [...project.files, { path: 'src/main.ts', content: 'export const answer = 42;' }], scene: { objects: [{ id: randomUUID(), name: 'Engine', kind: 'box', position:[2,.5,0],rotation:[0,45,0],scale:[2,1,1],color:'#83ceff' }] } };
  assert.equal((await call('PUT', `/${project.id}`, 'bob', body)).status, 404);
  assert.equal((await call('PUT', `/${project.id}`, 'alice', body, 'https://evil.example')).status, 403);
  const saved = await call('PUT', `/${project.id}`, 'alice', body, 'http://localhost');
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).project.revision, 2);
  assert.equal((await call('PUT', `/${project.id}`, 'alice', body)).status, 409);
  const reopened = await (await call('GET', `/${project.id}`)).json();
  assert.equal(reopened.project.files[1].content, body.files[1].content);
  assert.deepEqual(reopened.project.scene, body.scene);
  // A separate process reads the committed SQLite document, not an in-memory cache.
  const count = execFileSync(process.execPath, ['--input-type=module', '-e', "import Database from 'better-sqlite3'; const db=new Database(process.env.DB_PATH); const r=db.prepare('SELECT document FROM workspace_projects').get(); console.log(JSON.parse(r.document).scene.objects[0].name);db.close();"], { encoding:'utf8' });
  assert.equal(count.trim(), 'Engine');
});

test('rejects malformed, oversized, duplicate and out-of-range project documents', async () => {
  assert.equal((await call('POST', '/', 'alice', { name: ' ' })).status, 400);
  const { project } = await (await call('POST', '/', 'alice', { name: 'Validation' })).json();
  const valid = { name: project.name, revision:1, files: [], scene: { objects: [] } };
  for (const filePath of ['../secret', '/root/key', 'src/../key', 'src\\key']) {
    assert.equal((await call('PUT', `/${project.id}`, 'alice', { ...valid, files:[{path:filePath,content:''}] })).status, 400);
  }
  assert.equal((await call('PUT', `/${project.id}`, 'alice', { ...valid, files:[{path:'a',content:''},{path:'a',content:''}] })).status, 400);
  const o = { id:randomUUID(),name:'Box',kind:'box',position:[0,0,0],rotation:[0,0,0],scale:[0,1,1],color:'#abcdef' };
  assert.equal((await call('PUT', `/${project.id}`, 'alice', { ...valid, scene:{objects:[o]} })).status, 400);
  assert.equal((await call('PUT', `/${project.id}`, 'alice', { ...valid, scene:{objects:[{...o,scale:[1,1,1],kind:'script'}]} })).status, 400);
  assert.equal((await call('PUT', `/${project.id}`, 'alice', { ...valid, files:[{path:'a',content:'x'.repeat(1_000_001)}] })).status, 413);
  const malformed = await projectsApi.request('http://localhost/', {method:'POST',headers:{cookie:'grokbot_session=alice','content-type':'application/json'},body:'{bad'});
  assert.equal(malformed.status, 400);
});
