import { zipSync, strToU8 } from 'fflate';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
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
  const agents = await (await fetch(`${base}/api/workspace/${project.id}/agents`, {headers})).json(); assert.deepEqual(agents.agents, []);
  const proposals = await (await fetch(`${base}/api/workspace/${project.id}/proposals`, {headers})).json(); assert.deepEqual(proposals.proposals, []);
  const runtime = await (await fetch(`${base}/api/workspace/runtime?projectId=${project.id}`, { headers })).json(); assert.equal(runtime.available, false);
  const run = await fetch(`${base}/api/workspace/${project.id}/runs`, { method: 'POST', headers, body: JSON.stringify({ revision: 1, command: 'test' }) }); assert.equal(run.status, 503);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/preview`)).status, 401);
  const sourceZip=zipSync({'small-main/index.html':strToU8('<h1>Imported HTTP source</h1>'),'small-main/.env':strToU8('FIXTURE=excluded')});
  const sourceReview=await fetch(`${base}/api/projects/import-source/review?name=HTTP%20source&stripRoot=true`,{method:'POST',headers:{...headers,'content-type':'application/zip'},body:sourceZip});
  assert.equal(sourceReview.status,200);const candidate=await sourceReview.json();assert.equal(candidate.sourceRoot,'small-main/');assert.equal(candidate.skipped.length,1);assert.equal(candidate.document.files[0].path,'index.html');
  const sourceImport=await fetch(`${base}/api/projects/import`,{method:'POST',headers,body:JSON.stringify(candidate.document)});assert.equal(sourceImport.status,201);
  const imported=(await sourceImport.json()).project;
  const sourcePreview=await fetch(`${base}/api/projects/${imported.id}/preview`,{headers});assert.match((await sourcePreview.json()).html,/Imported HTTP source/);
  assert.equal((await fetch(`${base}/api/projects/import-source/review`,{method:'POST',headers:{'content-type':'application/zip'},body:sourceZip})).status,401);
  // Seed disposable output records to check HTTP delivery; this is not a Docker build.
  const {validateArtifacts}=await import('../server/dist/workspace/artifact-protocol.js');
  const {createHash}=await import('node:crypto');
  const content=Buffer.from('<!doctype html><h1>HTTP build-output fixture</h1>');
  const retained=validateArtifacts({version:1,outputDirectory:'dist',files:[{path:'index.html',base64:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex')}]});
  const fixtureRun=randomUUID(),seed=new Database(path.join(root,'workspace.db'));
  try{seed.transaction(()=>{
    seed.prepare("INSERT INTO workspace_runs(id,project_id,revision,command,state,created_at,artifact_state) VALUES (?,?,1,'build','succeeded',?,'ready')").run(fixtureRun,project.id,Date.now());
    seed.prepare('INSERT INTO workspace_builds(run_id,output_directory,manifest_hash,total_bytes,created_at) VALUES (?,?,?,?,?)').run(fixtureRun,'dist',retained.manifestHash,retained.totalBytes,Date.now());
    for(const f of retained.files)seed.prepare('INSERT INTO workspace_build_files(run_id,path,bytes,sha256,mime,data) VALUES (?,?,?,?,?,?)').run(fixtureRun,f.path,f.bytes,f.sha256,f.mime,f.data);
  })();}finally{seed.close();}
  const build=await fetch(`${base}/api/workspace/runs/${fixtureRun}/outputs`,{headers});assert.equal(build.status,200);assert.equal((await build.json()).manifest.previewVerified,false);
  const zip=await fetch(`${base}/api/workspace/runs/${fixtureRun}/outputs.zip`,{headers});assert.equal(zip.status,200);assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0),0x04034b50);
  const builtPreview=await fetch(`${base}/api/workspace/runs/${fixtureRun}/build-preview`,{headers});assert.equal(builtPreview.status,200);assert.match((await builtPreview.json()).html,/HTTP build-output fixture/);
  assert.equal((await fetch(`${base}/api/workspace/runs/${fixtureRun}/outputs.zip`)).status,401);

  console.log('HTTP smoke passed: entry/bundle, local session, project, preview, source ZIP review/import, history, agent/proposal routes, seeded build download/preview, unavailable-worker refusal and unauthenticated access.');
} finally {
  clearTimeout(started); child.kill('SIGTERM');
  const killed = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited; clearTimeout(killed); await rm(root, { recursive: true, force: true });
}
