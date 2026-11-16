import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from '../db.js';
import { requireUser, type AuthVars } from '../lib/auth.js';
import { documentSchema, saveSchema, type Project, type ProjectDocument } from './schema.js';

db.exec(`CREATE TABLE IF NOT EXISTS workspace_projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS workspace_projects_owner ON workspace_projects(user_id, updated_at);`);

type Stored = { id: string; name: string; document: string; revision: number; updated_at: number };
const unpack = (row: Stored): Project => ({ ...JSON.parse(row.document), id: row.id, revision: row.revision, updatedAt: row.updated_at });
export const projectsApi = new Hono<AuthVars>();
projectsApi.use('*', requireUser);
projectsApi.use('*', bodyLimit({ maxSize: 1_000_000, onError: c => c.json({ error: 'Project exceeds the 1 MB request limit' }, 413) }));
// Cookie-authenticated writes must originate from this app. No cross-origin API use.
projectsApi.use('*', async (c, next) => {
  const origin = c.req.header('origin');
  if (c.req.method !== 'GET' && origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'Cross-origin write refused' }, 403);
  await next();
});
projectsApi.get('/', c => {
  const rows = db.prepare('SELECT id,name,revision,updated_at FROM workspace_projects WHERE user_id=? ORDER BY updated_at DESC').all(c.get('user').id) as Stored[];
  return c.json({ projects: rows.map(r => ({ id: r.id, name: r.name, revision: r.revision, updatedAt: r.updated_at })) });
});
projectsApi.post('/', async c => {
  const parsed = documentSchema.pick({ name: true }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Enter a project name between 1 and 80 characters' }, 400);
  const project: ProjectDocument = { name: parsed.data.name, files: [{ path: 'README.md', content: `# ${parsed.data.name}\n\nDescribe what you want to build here.\n` }], scene: { objects: [] } };
  const id = randomUUID(), updatedAt = Date.now();
  db.prepare('INSERT INTO workspace_projects(id,user_id,name,document,updated_at) VALUES (?,?,?,?,?)').run(id, c.get('user').id, project.name, JSON.stringify(project), updatedAt);
  return c.json({ project: { ...project, id, revision: 1, updatedAt } }, 201);
});
projectsApi.get('/:id', c => {
  const row = db.prepare('SELECT * FROM workspace_projects WHERE id=? AND user_id=?').get(c.req.param('id'), c.get('user').id) as Stored | undefined;
  return row ? c.json({ project: unpack(row) }) : c.json({ error: 'Project not found' }, 404);
});
projectsApi.put('/:id', async c => {
  const parsed = saveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid project' }, 400);
  const { revision, ...document } = parsed.data;
  const updatedAt = Date.now();
  const result = db.prepare('UPDATE workspace_projects SET name=?,document=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?')
    .run(document.name, JSON.stringify(document), updatedAt, c.req.param('id'), c.get('user').id, revision);
  if (!result.changes) {
    const exists = db.prepare('SELECT id FROM workspace_projects WHERE id=? AND user_id=?').get(c.req.param('id'), c.get('user').id);
    return exists ? c.json({ error: 'This project changed in another tab. Export your work, then reopen the project before saving.' }, 409) : c.json({ error: 'Project not found' }, 404);
  }
  return c.json({ project: { ...document, id: c.req.param('id'), revision: revision + 1, updatedAt } });
});
