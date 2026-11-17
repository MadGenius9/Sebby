import { VOICE_SAMPLE_RATE } from './realtime-voice.js';

export function requestVoiceSample(apiKey: string, sample: {
  text: string; voice: string; language: string; speed: number; codec: 'pcm' | 'mp3';
}, request = fetch, clientSignal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30_000);
  return request('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: sample.text, voice_id: sample.voice, language: sample.language, speed: sample.speed,
      output_format: { codec: sample.codec, sample_rate: VOICE_SAMPLE_RATE },
    }),
    signal: clientSignal ? AbortSignal.any([timeout, clientSignal]) : timeout,
  });
}
