import type { TurnResult } from './agent/loop.js';

/** Call-scoped jobs, deduplicated by the provider's tool-call ID. */
export class VoiceWork {
  private jobs = new Map<string, { id: string; request: string; status: 'pending' | TurnResult['status']; text: string }>();

  submit(id: string, request: string, run: () => Promise<TurnResult>) {
    const existing = this.jobs.get(id);
    if (existing) {
      if (existing.request !== request) throw new Error('Tool-call ID already used');
      return existing;
    }
    if (!id || id.length > 200 || !request.trim() || request.length > 16000) throw new Error('Invalid voice request');
    if (this.jobs.size >= 20) throw new Error('Voice task limit reached');
    const job = { id, request, status: 'pending' as 'pending' | TurnResult['status'], text: '' };
    this.jobs.set(id, job);
    Promise.resolve().then(run).then(result => Object.assign(job, { ...result, text: result.text.slice(-4000) }), () => {
      job.status = 'failed'; job.text = 'The agent could not finish this request.';
    });
    return job;
  }

  snapshot() { return [...this.jobs.values()].map(job => ({ ...job })); }
}
