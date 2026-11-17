import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(os.tmpdir(), 'sebby-local-voice-'));
process.env.SEBBY_WORKSPACE_ONLY = '1';
process.env.SESSION_SECRET = randomUUID();
process.env.DB_PATH = path.join(root, 'local.db');
const { db } = await import('../server/src/db.js');
const { createLocalVoiceApi } = await import('../server/src/workspace/local-voice.js');
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('voice-user', 'voice@example.test', 'Voice user', Date.now());
db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run('fixture-session', 'voice-user', Date.now(), Date.now() + 60000);
const origin = 'http://127.0.0.1:8787';
const config = { apiKey: 'server-only-fixture-key', origin, model: 'grok-voice-latest' };
const headers = { origin, cookie: 'grokbot_session=fixture-session' };

test('local voice only mints a temporary browser token for authenticated same-origin calls', async () => {
  let requests = 0;
  const upstream: typeof fetch = async (url, init) => {
    requests++;
    assert.equal(String(url), 'https://api.x.ai/v1/realtime/client_secrets');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + config.apiKey);
    assert.deepEqual(JSON.parse(String(init?.body)), { expires_after: { seconds: 60 } });
    return Response.json({ value: 'temporary-token', expires_at: 1795000000 });
  };
  const api = createLocalVoiceApi(config, upstream);
  assert.equal((await api.request('/status')).status, 401);
  assert.equal((await api.request('/session', { method: 'POST' })).status, 401);
  assert.equal((await api.request('/session', { method: 'POST', headers: { ...headers, origin: 'http://another.test' } })).status, 403);
  assert.equal(requests, 0);
  const response = await api.request('/session', { method: 'POST', headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.text();
  assert.ok(!payload.includes(config.apiKey));
  const session = JSON.parse(payload);
  assert.equal(session.clientSecret, 'temporary-token');
  assert.equal(session.sampleRate, 24000);
  assert.deepEqual(session.session.tools, []);
  assert.deepEqual(session.session.turn_detection, { type: 'server_vad' });
  assert.equal((await api.request('/session', { method: 'POST', headers })).status, 429);
  assert.equal(requests, 1);
});

test('missing keys and upstream errors give actionable responses without exposing provider details', async () => {
  const unconfigured = createLocalVoiceApi({ ...config, apiKey: '' }, async () => { throw new Error('Unexpected request'); });
  assert.deepEqual(await (await unconfigured.request('/status', { headers })).json(), { configured: false });
  assert.equal((await unconfigured.request('/session', { method: 'POST', headers })).status, 503);
  const failing = createLocalVoiceApi(config, async () => Response.json({ message: config.apiKey }, { status: 401 }));
  const failure = await failing.request('/session', { method: 'POST', headers });
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes(config.apiKey));
});
