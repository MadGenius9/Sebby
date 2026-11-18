import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { requestVoiceSample } from '../lib/voice-sample.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_WORKSPACE_VOICE, isWorkspaceVoicePreferences } from '../lib/voice-preferences.js';
import { requireUser, type AuthVars } from '../lib/auth.js';
import { localVoiceSession, mintVoiceSecret } from '../lib/realtime-voice.js';

export function createLocalVoiceApi(config: { apiKey: string; origin: string; model: string; credentialDirectory: string }, request = fetch) {
  const app = new Hono<AuthVars>();
  const origin = new URL(config.origin).origin;
  app.use('*', requireUser);
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  const credentialPath = (userId: string) => path.join(config.credentialDirectory, createHash('sha256').update(userId).digest('hex'));
  function credential(userId: string) {
    try {
      return { key: readFileSync(credentialPath(userId), 'utf8'), source: 'saved' as const };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { key: config.apiKey, source: config.apiKey ? 'environment' as const : 'none' as const };
    }
  }
  function status(userId: string) {
    const { key, source } = credential(userId);
    return { configured: Boolean(key), source };
  }
  app.onError((_error, c) => c.json({ error: 'Could not access local voice settings.' }, 500));
  app.get('/status', c => c.json(status(c.get('user').id)));

  app.post('/key', bodyLimit({ maxSize: 2048 }), async c => {
    if (c.req.header('origin') !== origin) return c.json({ error: 'Open the local workspace to change the xAI key' }, 403);
    const input = await c.req.json().catch(() => null);
    const key = typeof input?.key === 'string' ? input.key.trim() : '';
    if (!/^[!-~]{1,512}$/.test(key)) return c.json({ error: 'Paste your xAI API key as a single line.' }, 400);
    const file = credentialPath(c.get('user').id);
    const temporary = file + '.' + randomUUID();
    mkdirSync(config.credentialDirectory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporary, key, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    return c.json({ configured: true, source: 'saved' });
  });

  app.post('/key/remove', c => {
    if (c.req.header('origin') !== origin) return c.json({ error: 'Open the local workspace to change the xAI key' }, 403);
    const userId = c.get('user').id;
    rmSync(credentialPath(userId), { force: true });
    return c.json(status(userId));
  });

  let starting = false;
  let lastRequest = 0;
  app.post('/session', bodyLimit({ maxSize: 1024 }), async c => {
    if (c.req.header('origin') !== origin) return c.json({ error: 'Open the local workspace to start a call' }, 403);
    const { key } = credential(c.get('user').id);
    if (!key) return c.json({ error: 'Add your xAI API key in Voice settings.' }, 503);
    const body = await c.req.text();
    let preferences: unknown;
    try {
      const input: unknown = body ? JSON.parse(body) : {};
      preferences = input && typeof input === 'object' && !Array.isArray(input) && !Object.keys(input).length
        ? DEFAULT_WORKSPACE_VOICE : input;
    } catch {
      return c.json({ error: 'Invalid voice settings' }, 400);
    }
    if (!isWorkspaceVoicePreferences(preferences)) return c.json({ error: 'Choose a supported voice and speaking speed' }, 400);
    if (starting || Date.now() - lastRequest < 2000) return c.json({ error: 'Wait a moment before starting another call' }, 429);
    starting = true;
    lastRequest = Date.now();
    try {
      const session = localVoiceSession(await mintVoiceSecret(key, request), config.model, preferences);
      return c.json(session, 200, { 'Cache-Control': 'no-store' });
    } catch {
      return c.json({ error: 'Grok could not start the call. Check your xAI key and account access.' }, 502);
    } finally {
      starting = false;
    }
  });
  let previewing = false;
  app.post('/preview', bodyLimit({ maxSize: 1024 }), async c => {
    if (c.req.header('origin') !== origin) return c.json({ error: 'Open the local workspace to preview a voice' }, 403);
    const { key } = credential(c.get('user').id);
    if (!key) return c.json({ error: 'Add your xAI API key in Voice settings.' }, 503);
    const preferences: unknown = await c.req.json().catch(() => null);
    if (!isWorkspaceVoicePreferences(preferences)) return c.json({ error: 'Choose a supported voice and speaking speed' }, 400);
    if (previewing) return c.json({ error: 'A preview is already loading' }, 429);

    previewing = true;
    try {
      const response = await requestVoiceSample(key, {
        text: 'Hi, I’m Sebby. This is how I’ll sound during our next call.',
        voice: preferences.voice, speed: preferences.speed, language: 'en', codec: 'pcm',
      }, request, c.req.raw.signal);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error('Provider voice preview failed');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 1_000_000) throw new Error('Voice preview exceeded output limit');
          chunks.push(part.value);
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (bytes === 0 || bytes % 2 !== 0) throw new Error('Incomplete PCM preview');
      return c.body(Buffer.concat(chunks, bytes), 200, {
        'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store',
      });
    } catch {
      return c.json({ error: 'Grok could not create a preview. Check your xAI key and account access.' }, 502);
    } finally {
      previewing = false;
    }
  });
  return app;
}
