// The in-browser voice agent. Grok Bot runs calls as a second, lightweight agent against the xAI realtime
// API that speaks as the bot and relays real work to the bot's main text agent (send_task). Results come
// back through call-scoped job status and are injected into the call as [work_landed] notes.
import { create } from 'zustand';
import { useStore } from '../store';
import { voiceApi, type VoiceSession } from './api';
import { MicCapture, PcmPlayer, base64ToPcm, createAudioContext, micErrorMessage, openMic, pcmToBase64 } from './audio';

export interface Caption { id: string; role: 'user' | 'assistant'; text: string; final: boolean }

export type CallStatus = 'idle' | 'connecting' | 'live' | 'ending' | 'error';

interface VoiceState {
  status: CallStatus;
  botId: string | null;
  callId: string | null;
  muted: boolean;
  /** Bot audio is playing. */
  speaking: boolean;
  /** Server VAD hears the user. */
  listening: boolean;
  /** A response is being generated but no audio yet. */
  thinking: boolean;
  /** send_task requests still running in the text agent. */
  working: { seq: string; request: string }[];
  captions: Caption[];
  error: string | null;
  startedAt: number | null;
}

export const useVoice = create<VoiceState>(() => ({
  status: 'idle', botId: null, callId: null, muted: false, speaking: false, listening: false, thinking: false,
  working: [], captions: [], error: null, startedAt: null,
}));

const setV = (p: Partial<VoiceState>) => useVoice.setState(p);

let current: VoiceCall | null = null;

/** Start a call with a bot. Must be called from a user gesture (click) so audio can start. */
export function startCall(botId: string) {
  if (current && !current.ended) {
    if (current.botId === botId) return;
    current.end();
  }
  current = new VoiceCall(botId);
  void current.start();
}

export function endCall() { current?.end(); }
export function toggleMute() { current?.setMuted(!useVoice.getState().muted); }
export function callLevels(): { out: number; mic: number } {
  return current && !current.ended ? { out: current.player.level(), mic: current.micLevel() } : { out: 0, mic: 0 };
}
export const isCallActive = (s: VoiceState = useVoice.getState()) => s.status === 'connecting' || s.status === 'live';

type Json = Record<string, any>;


export class VoiceCall {
  ended = false;
  readonly ctx: AudioContext;
  readonly player: PcmPlayer;
  private mic: MicCapture | null = null;
  private ws: WebSocket | null = null;
  private sess: VoiceSession | null = null;
  private ready = false;
  private responseActive = false;
  private responseSpoke = false;
  private responseId: string | null = null;
  /** Response the user talked over; its late audio deltas are dropped. */
  private interruptedId: string | null = null;
  private userSpeaking = false;
  private inflight = new Map<string, { name: string; promise: Promise<string> }>();
  private handledCalls = new Set<string>();
  private tasks = new Map<string, string>();
  private workFailures = 0;
  private approvalNotice: string | null = null;
  private notes: string[] = [];
  private flushWaiting = false;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private onUnload = () => {
    if (this.sess && !this.ended) voiceApi.endBeacon(this.botId, this.sess.callId, this.transcript());
    this.end(undefined, true);
  };

  constructor(readonly botId: string) {
    // Created synchronously inside the click so autoplay policy lets it run.
    this.ctx = createAudioContext();
    this.player = new PcmPlayer(this.ctx);
    this.player.onStart = () => { if (!this.ended) setV({ speaking: true, thinking: false }); };
    this.player.onIdle = () => { if (!this.ended) setV({ speaking: false }); };
  }

  micLevel() { return useVoice.getState().muted ? 0 : this.mic?.level ?? 0; }

  async start() {
    setV({ status: 'connecting', botId: this.botId, callId: null, muted: false, speaking: false, listening: false, thinking: false, working: [], captions: [], error: null, startedAt: null });
    window.addEventListener('pagehide', this.onUnload);
    let stream: MediaStream;
    try {
      stream = await openMic();
    } catch (e) {
      this.end(micErrorMessage(e));
      return;
    }
    if (this.ended) { stream.getTracks().forEach((t) => t.stop()); return; }
    try {
      this.mic = new MicCapture(this.ctx, stream, (pcm) => this.sendAudio(pcm));
      await this.mic.start();
      if (this.ended) { this.mic.stop(); return; }
      this.sess = await voiceApi.session(this.botId);
      if (this.ended) { void voiceApi.end(this.botId, this.sess.callId, [], 'Cancelled').catch(() => {}); return; }
      setV({ callId: this.sess.callId });
      this.connect(this.sess);
    } catch (e) {
      this.end((e as Error).message || 'Could not start the call');
    }
  }

  private connect(sess: VoiceSession) {
    const ws = new WebSocket(sess.websocketUrl, [`xai-client-secret.${sess.clientSecret}`]);
    this.ws = ws;
    this.connectTimer = setTimeout(() => { if (!this.ready) this.end('Couldn’t connect the call'); }, 15000);
    ws.onopen = () => this.send({ type: 'session.update', session: sess.session });
    ws.onmessage = (m) => {
      if (this.ended) return;
      if (typeof m.data !== 'string') return;
      try { this.handle(JSON.parse(m.data)); } catch (e) { console.warn('[voice] bad event', e); }
    };
    ws.onclose = (e) => {
      if (this.ended) return;
      this.end(this.ready ? 'Call dropped' : `Couldn’t connect the call${e.reason ? ` (${e.reason})` : ''}`);
    };
  }

  private send(ev: Json) {
    if (!this.ended && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }

  private sendAudio(pcm: Int16Array) {
    if (!this.ready || this.ended || useVoice.getState().muted) return;
    this.send({ type: 'input_audio_buffer.append', audio: pcmToBase64(pcm) });
  }

  setMuted(m: boolean) {
    if (this.mic) this.mic.muted = m;
    if (m && this.ready) this.send({ type: 'input_audio_buffer.clear' });
    setV({ muted: m, listening: m ? false : useVoice.getState().listening });
  }

  // ---------- realtime events ----------

  private handle(ev: Json) {
    if (this.ended) return;
    switch (ev.type) {
      case 'session.updated':
        if (!this.ready) {
          this.ready = true;
          if (this.connectTimer) clearTimeout(this.connectTimer);
          setV({ status: 'live', startedAt: Date.now() });
          this.send({ type: 'response.create' }); // the bot greets first
        }
        return;

      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true;
        setV({ listening: true });
        // Barge-in: stop talking and listen.
        if (this.player.playing) this.player.clear();
        if (this.responseActive) {
          this.interruptedId = this.responseId;
          this.send({ type: 'response.cancel' });
        }
        return;
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        this.userSpeaking = false;
        setV({ listening: false });
        this.flushNotes();
        return;

      case 'conversation.item.added':
      case 'conversation.item.created': {
        const item = ev.item ?? {};
        if (item.role === 'user' && Array.isArray(item.content) && item.content.some((c: Json) => c?.type === 'input_audio')) {
          const t = item.content.find((c: Json) => c?.transcript)?.transcript;
          this.caption(item.id, 'user', t ?? '', !!t, 'set');
        }
        return;
      }
      // xAI sends the cumulative transcript in `.updated`; OpenAI sends `.delta` increments.
      case 'conversation.item.input_audio_transcription.updated':
        this.caption(ev.item_id, 'user', ev.transcript ?? '', false, 'set');
        return;
      case 'conversation.item.input_audio_transcription.delta':
        this.caption(ev.item_id, 'user', ev.delta ?? '', false, 'append');
        return;
      case 'conversation.item.input_audio_transcription.completed':
        this.caption(ev.item_id, 'user', ev.transcript ?? '', true, 'set');
        return;

      case 'response.created':
        this.responseActive = true;
        this.responseSpoke = false;
        this.responseId = ev.response?.id ?? null;
        setV({ thinking: true });
        return;
      case 'response.output_item.added':
        if (ev.item?.type === 'message') this.caption(ev.item.id, 'assistant', '', false, 'set');
        return;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta':
        this.responseSpoke = true;
        this.caption(ev.item_id, 'assistant', ev.delta ?? '', false, 'append');
        return;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (ev.transcript) this.caption(ev.item_id, 'assistant', ev.transcript, true, 'set');
        return;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (ev.delta && !(this.interruptedId && ev.response_id === this.interruptedId)) {
          this.responseSpoke = true;
          this.player.push(base64ToPcm(ev.delta), this.sess?.sampleRate);
        }
        return;

      case 'response.function_call_arguments.done':
        this.startTool(ev.call_id, ev.name, ev.arguments);
        return;
      case 'response.done': {
        this.responseActive = false;
        setV({ thinking: false });
        for (const o of (ev.response?.output ?? []) as Json[]) if (o?.type === 'function_call') this.startTool(o.call_id, o.name, o.arguments);
        if (this.inflight.size) void this.finishTools(this.responseSpoke);
        else this.flushNotes();
        return;
      }

      case 'error': {
        const code = ev.error?.code ?? ev.code ?? '';
        if (/cancel/i.test(String(code)) || /no active response/i.test(String(ev.error?.message ?? ''))) return;
        console.warn('[voice] realtime error', ev.error ?? ev);
        this.end('Voice service error. Please start a new call.');
        return;
      }
    }
  }

  private caption(id: string | undefined, role: Caption['role'], text: string, final: boolean, mode: 'set' | 'append') {
    if (!id) return;
    const caps = useVoice.getState().captions;
    const i = caps.findIndex((c) => c.id === id);
    if (i < 0) {
      setV({ captions: [...caps, { id, role, text, final }].slice(-200) });
      return;
    }
    const prev = caps[i];
    const next = { ...prev, text: mode === 'append' ? prev.text + text : text || prev.text, final: final || prev.final };
    const copy = caps.slice();
    copy[i] = next;
    setV({ captions: copy });
  }

  transcript() {
    return useVoice.getState().captions.filter((c) => c.text.trim()).map((c) => ({ role: c.role, text: c.text.trim() }));
  }

  // ---------- relay tools ----------

  private startTool(callId: string | undefined, name: string | undefined, rawArgs: string | undefined) {
    if (this.ended || !callId || !name || this.handledCalls.has(callId)) return;
    this.handledCalls.add(callId);
    let args: Json = {};
    try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { /* model sent bad JSON */ }
    let promise: Promise<string>;
    if (name === 'end_the_call') promise = Promise.resolve('Ending the call.');
    else {
      // Show "working" right away; replaced by the real task once the server answers.
      const placeholder = { seq: `pending:${callId}`, request: String(args.request ?? '') };
      const dropOptimistic = () => setV({ working: useVoice.getState().working.filter((x) => x !== placeholder) });
      if (name === 'send_task') setV({ working: [...useVoice.getState().working, placeholder] });
      promise = voiceApi.tool(this.botId, this.sess!.callId, name, args, callId)
        .then((r) => {
          if (this.ended) return r.output;
          if (name === 'send_task') {
            dropOptimistic();
            if (r.taskId) this.addTask(r.taskId, String(args.request ?? ''));
          }
          return r.output;
        })
        .catch((e) => {
          if (!this.ended && name === 'send_task') dropOptimistic();
          return `Tool error: ${(e as Error).message}. Tell the user it didn't go through.`;
        });
    }
    this.inflight.set(callId, { name, promise });
  }

  private async finishTools(spoke: boolean) {
    const batch = [...this.inflight.entries()];
    this.inflight.clear();
    const outputs = await Promise.all(batch.map(([, b]) => b.promise));
    if (this.ended) return;
    // Every output first, then a single response.create (xAI parallel-call rule).
    batch.forEach(([callId], i) => this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: outputs[i] } }));
    if (batch.some(([, b]) => b.name === 'end_the_call')) {
      await this.player.whenIdle(8000);
      this.end();
      return;
    }
    // A hand-off the bot already announced needs no follow-up turn; read tools do.
    const needsReply = !spoke || batch.some(([, b]) => b.name !== 'send_task');
    if (needsReply) {
      await this.player.whenIdle(8000); // don't talk over the current sentence
      if (!this.ended && !this.responseActive && !this.inflight.size) this.send({ type: 'response.create' });
    } else this.flushNotes();
  }

  // ---------- work_landed: retrieve the exact turn requested by voice ----------

  private addTask(id: string, request: string) {
    this.tasks.set(id, request);
    this.syncWorking();
    this.scheduleCheck(250);
  }

  private syncWorking() {
    const pending = useVoice.getState().working.filter(x => x.seq.startsWith('pending:'));
    setV({ working: [...this.tasks].map(([seq, request]) => ({ seq, request })).concat(pending) });
  }


  private scheduleCheck(ms: number) {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.checkTasks(), ms);
  }

  private async checkTasks() {
    if (this.ended || !this.tasks.size || !this.sess) return;
    try {
      const { jobs, awaiting } = await voiceApi.work(this.sess.callId);
      if (this.ended) return;
      this.workFailures = 0;
      if (awaiting && awaiting !== this.approvalNotice) this.queueNote(`Your agent is waiting for approval or input in chat: ${clip(awaiting, 300)}. Ask the user to review it on screen.`);
      this.approvalNotice = awaiting ?? null;
      for (const job of jobs) {
        if (!this.tasks.has(job.id) || job.status === 'pending') continue;
        this.tasks.delete(job.id);
        this.queueNote(`Tracked request: ${clip(job.request, 200)}. Status: ${job.status}. Result: ${clip(job.text, 1800) || 'No written result was returned; do not claim a successful outcome.'}`);
      }
      this.syncWorking();
    } catch {
      if (this.ended) return;
      if (++this.workFailures >= 3) { this.end('Lost task updates. Check chat for results; submitted work may continue.'); return; }
    }
    if (this.tasks.size) this.scheduleCheck(1000);
  }

  private firstName() {
    return (useStore.getState().user?.name ?? '').split(/\s+/)[0] || 'the user';
  }

  private queueNote(text: string) {
    this.notes.push(text);
    this.flushNotes();
  }

  private flushNotes() {
    if (!this.ready || this.ended || !this.notes.length) return;
    if (this.responseActive || this.userSpeaking || this.inflight.size) return; // retried on response.done / speech_stopped
    if (this.player.playing) {
      if (!this.flushWaiting) {
        this.flushWaiting = true;
        void this.player.whenIdle().then(() => { this.flushWaiting = false; this.flushNotes(); });
      }
      return;
    }
    const text = this.notes.splice(0).map((n) => `[work_landed] ${n}`).join('\n\n');
    // A user-role item: the voice model ignores system-role items mid-call (tested), but relays these.
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${text}\n\n(Automatic note from your text agent, not spoken by ${this.firstName()}. Tell them the outcome now, briefly.)` }] } });
    this.send({ type: 'response.create' });
  }

  // ---------- teardown ----------

  end(error?: string, beaconSent = false) {
    if (this.ended) return;
    this.ended = true;
    window.removeEventListener('pagehide', this.onUnload);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    try { this.ws?.close(1000, 'call ended'); } catch { /* ignore */ }
    this.mic?.stop();
    this.player.dispose();
    void this.ctx.close().catch(() => {});
    const transcript = this.transcript();
    if (this.sess && !beaconSent) void voiceApi.end(this.botId, this.sess.callId, transcript, error).catch((e) => console.warn('[voice] end failed', e));
    if (current === this) current = null;
    if (error) {
      setV({ status: 'error', error, speaking: false, listening: false, thinking: false, working: [] });
      setTimeout(() => { if (useVoice.getState().status === 'error' && !current) setV({ status: 'idle', botId: null, error: null }); }, 6000);
    } else {
      setV({ status: 'idle', botId: null, callId: null, speaking: false, listening: false, thinking: false, working: [], startedAt: null });
    }
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Play a short TTS sample through the same PCM path the call uses. */
export async function previewVoice(p: { botId: string; voice?: string; speed?: number; language?: string }): Promise<void> {
  const ctx = createAudioContext();
  const player = new PcmPlayer(ctx);
  try {
    const pcm = await voiceApi.preview(p);
    // Feed it in 100 ms chunks, like realtime deltas.
    for (let i = 0; i < pcm.length; i += 2400) player.push(pcm.subarray(i, i + 2400));
    await player.whenIdle(30000);
  } finally {
    player.dispose();
    void ctx.close().catch(() => {});
  }
}
