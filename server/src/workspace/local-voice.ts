import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DEFAULT_WORKSPACE_VOICE, isWorkspaceVoicePreferences } from '../lib/voice-preferences.js';
import { requireUser, type AuthVars } from '../lib/auth.js';
import { localVoiceSession, mintVoiceSecret } from '../lib/realtime-voice.js';

export function createLocalVoiceApi(config: { apiKey: string; origin: string; model: string }, request = fetch) {
  const app = new Hono<AuthVars>();
  const origin = new URL(config.origin).origin;
  app.use('*', requireUser);
  app.get('/status', c => c.json({ configured: Boolean(config.apiKey) }, 200, { 'Cache-Control': 'no-store' }));

  let starting = false;
  let lastRequest = 0;
  app.post('/session', bodyLimit({ maxSize: 1024 }), async c => {
    if (c.req.header('origin') !== origin) return c.json({ error: 'Open the local workspace to start a call' }, 403);
    if (!config.apiKey) return c.json({ error: 'Set XAI_API_KEY in .env.local and restart Sebby' }, 503);
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
      const session = localVoiceSession(await mintVoiceSecret(config.apiKey, request), config.model, preferences);
      return c.json(session, 200, { 'Cache-Control': 'no-store' });
    } catch {
      return c.json({ error: 'Grok could not start the call. Check your xAI key and account access.' }, 502);
    } finally {
      starting = false;
    }
  });
  return app;
}
