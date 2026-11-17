// Disposable acceptance data only. No test routes or provider credentials are added to the app.
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdir, symlink, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function browserFixtures(root) {
  process.env.SEBBY_WORKSPACE_ONLY = '1';
  process.env.SESSION_SECRET = randomUUID();
  process.env.DB_PATH = path.join(root, 'workspace.db');
  process.env.SEBBY_RUNS_DIR = path.join(root, 'runs');
  const { db } = await import('../server/dist/db.js');
  const { WORKSPACE_TOOLS } = await import('../server/dist/workspace/agent-tools.js');
  const { bindingFor } = await import('../server/dist/workspace/collaboration.js');
  const { ownedProject, snapshotHash } = await import('../server/dist/workspace/repository.js');
  const { retainArtifacts, validateArtifacts } = await import('../server/dist/workspace/artifacts.js');
  const user = db.prepare('SELECT id FROM users WHERE email=?').get('browser-fixture@example.test');
  if (!user) throw new Error('Browser fixture user must sign in first');
  const botId = randomUUID();
  db.prepare('INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(botId, user.id, 'Fixture modeler', Date.now(), Date.now());
  return {
    botId,
    close: () => db.close(),
    project: id => ownedProject(user.id, id),
    async modelProposal(projectId, summary = 'Make an editable prop') {
      const project = ownedProject(user.id, projectId), binding = bindingFor(user.id, botId), id = randomUUID();
      if (!project || !binding || binding.projectId !== projectId) throw new Error('Assign the fixture agent through the UI first');
      const tool = WORKSPACE_TOOLS.find(t => t.name === 'project_propose_scene_operations');
      return JSON.parse((await tool.impl({ projectId, grantId: binding.grantId, revision: project.revision, summary, operations: [
        { op: 'add', id, name: 'Agent prop', kind: 'editable-cube' },
        { op: 'extrude', id, face: 3, distance: 0.25 },
        { op: 'inset', id, face: 3, ratio: 0.2 },
      ] }, { userId: user.id, botId, workspaceGrantId: binding.grantId })).output).proposal;
    },
    async buildFixture(projectId) {
      const project = ownedProject(user.id, projectId), directory = path.join(root, 'trusted-browser-build');
      await mkdir(directory);
      await symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir');
      await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(directory, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="/src.jsx"></script>');
      await writeFile(path.join(directory, 'src.jsx'), 'import React,{useState} from "react";import {createRoot} from "react-dom/client";import "./style.css";function App(){const [count,setCount]=useState(0);return <button onClick={()=>setCount(count+1)}>Compiled clicks: {count}</button>}createRoot(document.getElementById("root")).render(<App/>);');
      await writeFile(path.join(directory, 'style.css'), 'body{font-family:sans-serif;padding:24px}button{background:royalblue;color:white;padding:16px}');
      const require = createRequire(new URL('../web/package.json', import.meta.url));
      const { build } = await import(pathToFileURL(require.resolve('vite')).href);
      await build({ configFile: false, root: directory, base: './', logLevel: 'silent', build: { outDir: 'dist', emptyOutDir: true, minify: false } });
      const files = [];
      for (const entry of await readdir(path.join(directory, 'dist'), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const absolute = path.join(entry.parentPath, entry.name), name = path.relative(path.join(directory, 'dist'), absolute).split(path.sep).join('/'), data = await readFile(absolute);
        files.push({ path: name, base64: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex') });
      }
      const artifacts = validateArtifacts({ version: 1, outputDirectory: 'dist', files }), runId = randomUUID();
      db.transaction(() => {
        db.prepare("INSERT INTO workspace_runs(id,project_id,revision,command,state,log,snapshot_hash,exit_code,created_at,finished_at,artifact_state) VALUES (?,?,?,'build','succeeded',?,?,0,?,?,'ready')").run(runId, projectId, project.revision, 'Browser fixture: trusted authored Vite output, not a Docker execution.', snapshotHash(project), Date.now(), Date.now());
        retainArtifacts(runId, artifacts);
      })();
      return { runId, files: files.map(f => f.path) };
    },
  };
}
