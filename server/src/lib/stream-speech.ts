import WebSocket from 'ws';

export function streamSpeech(text: string, settings: { voice: string; language: string; speed: number }, apiKey: string, signal: AbortSignal) {
  const query = new URLSearchParams({
    voice: settings.voice, language: settings.language, speed: String(settings.speed),
    codec: 'pcm', sample_rate: '24000', optimize_streaming_latency: '1',
  });
  const socket = new WebSocket('wss://api.x.ai/v1/tts?' + query, {
    headers: { Authorization: 'Bearer ' + apiKey },
    maxPayload: 256 * 1024,
  });
  let stop: () => void;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      let bytes = 0;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', abort);
        if (error) controller.error(error);
        else controller.close();
        socket.terminate();
      };
      const abort = () => finish(new Error('Speech request ended'));
      stop = () => {
        finished = true;
        signal.removeEventListener('abort', abort);
        socket.terminate();
      };
      socket.on('error', () => finish(new Error('Grok speech is unavailable')));
      socket.on('close', () => finish(new Error('Speech ended before completion')));
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'text.delta', delta: text }));
        socket.send(JSON.stringify({ type: 'text.done' }));
      });
      socket.on('message', data => {
        if (finished) return;
        try {
          const event = JSON.parse(data.toString());
          if (event.type === 'audio.done') return finish();
          if (event.type === 'error') return finish(new Error('Grok speech is unavailable'));
          if (event.type !== 'audio.delta' || typeof event.delta !== 'string') return;
          const chunk = Buffer.from(event.delta, 'base64');
          bytes += chunk.length;
          if (bytes > 3_000_000) return finish(new Error('Speech exceeded its audio limit'));
          controller.enqueue(chunk);
        } catch {
          finish(new Error('Invalid speech response'));
        }
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    cancel() { stop(); },
  });
}
