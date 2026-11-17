import { createAudioContext, PcmPlayer } from './audio';
import type { Row } from '@shared/types';

export class SpokenReplies {
  private readonly context = createAudioContext();
  private readonly player = new PcmPlayer(this.context);
  private request?: AbortController;

  stop() {
    this.request?.abort();
    this.request = undefined;
    this.player.clear();
  }

  close() {
    this.stop();
    void this.context.close().catch(() => {});
  }

  async speak(row: Row) {
    this.stop();
    const request = new AbortController();
    this.request = request;
    try {
      await this.context.resume();
      if (request.signal.aborted) return;
      const response = await fetch('/api/voice/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: row.botId, seq: row.seq, generation: row.generation }),
        signal: request.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? 'Spoken reply unavailable');
      }
      if (!response.body) throw new Error('Spoken reply had no audio');
      const reader = response.body.getReader();
      let carry: number | undefined;
      let heard = false;
      try {
        while (!request.signal.aborted) {
          const { done, value } = await reader.read();
          if (done || request.signal.aborted) break;
          const bytes = new Uint8Array(value.length + (carry === undefined ? 0 : 1));
          if (carry !== undefined) bytes[0] = carry;
          bytes.set(value, carry === undefined ? 0 : 1);
          carry = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
          const samples = new Int16Array(Math.floor(bytes.length / 2));
          const view = new DataView(bytes.buffer);
          for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true);
          if (samples.length) {
            heard = true;
            this.player.push(samples);
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (!request.signal.aborted && (!heard || carry !== undefined)) throw new Error('Spoken reply had incomplete audio');
      await this.player.whenIdle(70000);
    } catch (error) {
      if (!request.signal.aborted) {
        this.player.clear();
        throw error;
      }
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }
}
