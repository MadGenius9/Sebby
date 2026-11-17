import { randomUUID } from 'node:crypto';

export const VOICE_SAMPLE_RATE = 24000;
const XAI_REALTIME = 'https://api.x.ai/v1/realtime';

export async function mintVoiceSecret(apiKey: string, request = fetch) {
  const response = await request(XAI_REALTIME + '/client_secrets', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { seconds: 60 } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Voice authentication rejected');
  const secret = await response.json();
  if (typeof secret?.value !== 'string' || !secret.value || !Number.isFinite(secret.expires_at)) {
    throw new Error('Invalid voice authentication response');
  }
  return { value: secret.value as string, expires_at: secret.expires_at as number };
}

export function realtimeVoiceUrl(model: string) {
  return 'wss://api.x.ai/v1/realtime?model=' + encodeURIComponent(model);
}

export function localVoiceSession(secret: Awaited<ReturnType<typeof mintVoiceSecret>>, model: string) {
  const instructions = 'You are Sebby, a friendly voice conversation partner. Greet the user briefly. Speak naturally, keep replies concise, and let the user respond. You can brainstorm and explain ideas. Use project details explicitly shared for the call as reference material. This call has no tools or direct access to project files or services. Never claim that you edited files, ran commands, or performed an external action.';
  return {
    callId: randomUUID(), clientSecret: secret.value, expiresAt: secret.expires_at,
    model, websocketUrl: realtimeVoiceUrl(model), sampleRate: VOICE_SAMPLE_RATE,
    instructions, voice: 'luna', speed: 1, language: 'auto', tools: [],
    session: {
      voice: 'luna', instructions, turn_detection: { type: 'server_vad' }, tools: [],
      audio: {
        input: { format: { type: 'audio/pcm', rate: VOICE_SAMPLE_RATE }, transcription: { model: 'grok-transcribe' } },
        output: { format: { type: 'audio/pcm', rate: VOICE_SAMPLE_RATE } },
      },
    },
  };
}
