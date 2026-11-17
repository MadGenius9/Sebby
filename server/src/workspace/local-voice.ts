import { Hono } from 'hono';
import { requireUser, type AuthVars } from '../lib/auth.js';
import { localVoiceSession, mintVoiceSecret } from '../lib/realtime-voice.js';

export function createLocalVoiceApi(config: { apiKey: string; origin: string; model: string }, request = fetch) {
  const app = new Hono<AuthVars>();
  const origin = new URL(config.origin).origin;
  app.use('*', requireUser);
  app.get('/status', c => c.json({ configured: Boolean(config.apiKey) }, 200, { 'Cache-Control': 'no-store' }));

  let starting = false;
  let lastRequest = 0;
  app.post('/session', async c => {
    if (c.req.header('origin') !== origin) return c.json({ error: 'Open the local workspace to start a call' }, 403);
    if (!config.apiKey) return c.json({ error: 'Set XAI_API_KEY in .env.local and restart Sebby' }, 503);
    if (starting || Date.now() - lastRequest < 2000) return c.json({ error: 'Wait a moment before starting another call' }, 429);
    starting = true;
    lastRequest = Date.now();
    try {
      const session = localVoiceSession(await mintVoiceSecret(config.apiKey, request), config.model);
      return c.json(session, 200, { 'Cache-Control': 'no-store' });
    } catch {
      return c.json({ error: 'Grok could not start the call. Check your xAI key and account access.' }, 502);
    } finally {
      starting = false;
    }
  });
  return app;
}
