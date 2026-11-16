import { runsApi, runService } from './workspace/runs.js';
// Provider-free local development server. Full Bot HQ services use index.ts.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { env } from './env.js';
import { createSession, destroySession, userFromCookieHeader } from './lib/auth.js';
import { projectsApi } from './workspace/projects.js';

if (process.env.SEBBY_WORKSPACE_ONLY !== '1' || !env.devLogin) throw new Error('Use npm run workspace for the local-only workspace server.');
const app = new Hono();
app.get('/api/health', c => c.json({ ok: true, mode: 'workspace', agents: false }));
app.get('/api/auth/me', c => c.json({ user: userFromCookieHeader(c.req.header('cookie')), devLogin: true, workspaceOnly: true }));
app.post('/api/auth/dev', async c => {
  const origin = c.req.header('origin');
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'Cross-origin write refused' }, 403);
  const input = await c.req.json().catch(() => null);
  if (!input || typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return c.json({ error: 'Enter a valid email address' }, 400);
  const email = input.email.trim().toLowerCase();
  let user = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string } | undefined;
  if (!user) {
    user = { id: randomUUID() };
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(user.id, email, email.split('@')[0], Date.now());
  }
  createSession(c, user.id);
  return c.json({ ok: true });
});
app.post('/api/auth/logout', c => { destroySession(c); return c.json({ ok: true }); });
app.route('/api/workspace', runsApi);
app.route('/api/projects', projectsApi);
app.all('/api/*', c => c.json({ error: 'This feature is not connected in workspace mode' }, 404));
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
app.use('/*', serveStatic({ root: path.relative(process.cwd(), webDist) }));
app.get('*', c => c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')));
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: env.port }, info => console.log(`Sebby workspace: http://127.0.0.1:${info.port}/workspace (local development only)`));

void runService.recover().catch(console.error);
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { void runService.shutdown().finally(() => process.exit(0)); });
