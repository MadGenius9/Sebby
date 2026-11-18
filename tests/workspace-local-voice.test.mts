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
const config = { apiKey: 'server-only-fixture-key', origin, model: 'grok-voice-latest', credentialDirectory: path.join(root, 'credentials') };
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
  assert.equal(session.session.voice, 'luna');
  assert.equal(session.session.audio.output.speed, 1);
  assert.deepEqual(session.session.tools, []);
  assert.deepEqual(session.session.turn_detection, { type: 'server_vad' });
  assert.equal((await api.request('/session', { method: 'POST', headers })).status, 429);
  assert.equal(requests, 1);
});

test('missing keys and upstream errors give actionable responses without exposing provider details', async () => {
  const unconfigured = createLocalVoiceApi({ ...config, apiKey: '' }, async () => { throw new Error('Unexpected request'); });
  assert.deepEqual(await (await unconfigured.request('/status', { headers })).json(), { configured: false, source: 'none' });
  assert.equal((await unconfigured.request('/session', { method: 'POST', headers })).status, 503);
  const failing = createLocalVoiceApi(config, async () => Response.json({ message: config.apiKey }, { status: 401 }));
  const failure = await failing.request('/session', { method: 'POST', headers });
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes(config.apiKey));
});


test('workspace voice validates preferences before minting and applies them to realtime audio', async () => {
  let requests = 0;
  const api = createLocalVoiceApi(config, async () => {
    requests++;
    return Response.json({ value: 'temporary-token', expires_at: 1795000000 });
  });
  const start = (body: unknown) => api.request('/session', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await start({ voice: 'unknown', speed: 1 })).status, 400);
  assert.equal((await start({ voice: 'rex', speed: 8 })).status, 400);
  assert.equal((await start({ voice: 'rex', speed: '1.15' })).status, 400);
  assert.equal(requests, 0);
  const result = await start({ voice: 'rex', speed: 1.15 });
  assert.equal(result.status, 200);
  assert.equal(requests, 1);
  const payload = await result.json();
  assert.equal(payload.session.voice, 'rex');
  assert.equal(payload.session.audio.output.speed, 1.15);
});

test('voice previews synthesize only the fixed sample for valid authenticated settings', async () => {
  let requests = 0;
  const api = createLocalVoiceApi(config, async (url, init) => {
    requests++;
    assert.equal(String(url), 'https://api.x.ai/v1/tts');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + config.apiKey);
    const request = JSON.parse(String(init?.body));
    assert.match(request.text, /I’m Sebby/);
    assert.equal(request.voice_id, 'rex');
    assert.equal(request.speed, 1.15);
    assert.deepEqual(request.output_format, { codec: 'pcm', sample_rate: 24000 });
    return new Response(new Uint8Array([0, 0, 1, 0]));
  });
  const body = JSON.stringify({ voice: 'rex', speed: 1.15, text: 'Untrusted caller-supplied text' });
  assert.equal((await api.request('/preview', { method: 'POST', body })).status, 401);
  assert.equal((await api.request('/preview', { method: 'POST', headers: { ...headers, origin: 'http://another.test' }, body })).status, 403);
  assert.equal((await api.request('/preview', { method: 'POST', headers, body: '{"voice":"other","speed":1}' })).status, 400);
  assert.equal(requests, 0);
  const response = await api.request('/preview', { method: 'POST', headers, body });
  assert.equal(requests, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 0, 1, 0]);
});

test('a saved key overrides the environment for its profile and stays server-side', async () => {
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('other-voice-user', 'other@example.test', 'Other user', Date.now());
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run('other-fixture-session', 'other-voice-user', Date.now(), Date.now() + 60000);
  const used = [];
  const upstream: typeof fetch = async (url, init) => {
    used.push(new Headers(init?.headers).get('authorization'));
    return String(url).endsWith('/tts')
      ? new Response(new Uint8Array([0, 0]))
      : Response.json({ value: 'temporary-token', expires_at: 1795000000 });
  };
  const localConfig = { ...config, credentialDirectory: path.join(root, 'profile-credentials') };
  const api = createLocalVoiceApi(localConfig, upstream);
  const change = (body: unknown, requestHeaders = headers) => api.request('/key', {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
  });
  assert.equal((await change({ key: 'should-not-save' }, { origin, cookie: '' })).status, 401);
  assert.equal((await change({ key: 'should-not-save' }, { ...headers, origin: 'http://other.test' })).status, 403);
  assert.equal((await change({ key: 'multiple\nlines' })).status, 400);
  const saved = await change({ key: ' first-fixture-key ' });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await saved.json(), { configured: true, source: 'saved' });
  assert.equal((await api.request('/session', { method: 'POST', headers })).status, 200);

  const other = { ...headers, cookie: 'grokbot_session=other-fixture-session' };
  assert.deepEqual(await (await api.request('/status', { headers: other })).json(), { configured: true, source: 'environment' });
  assert.equal((await change({ key: 'replacement-fixture-key' })).status, 200);
  const restarted = createLocalVoiceApi(localConfig, upstream);
  assert.deepEqual(await (await restarted.request('/status', { headers })).json(), { configured: true, source: 'saved' });
  assert.equal((await restarted.request('/preview', { method: 'POST', headers, body: '{"voice":"rex","speed":1}' })).status, 200);
  assert.deepEqual(used, ['Bearer first-fixture-key', 'Bearer replacement-fixture-key']);
  assert.equal((await restarted.request('/key/remove', { method: 'POST', headers: other })).status, 200);
  assert.deepEqual(await (await restarted.request('/status', { headers })).json(), { configured: true, source: 'saved' });
  const removed = await restarted.request('/key/remove', { method: 'POST', headers });
  assert.deepEqual(await removed.json(), { configured: true, source: 'environment' });
});
