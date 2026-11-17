import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const node = () => ({ connect() { return this; }, disconnect() {}, gain: { value: 0 } });
class FakeContext {
  state = 'running'; currentTime = 0; closed = false;
  destination = {}; audioWorklet = { addModule: async () => {} };
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
  createGain() { return node(); }
  createAnalyser() { return { ...node(), fftSize: 512, getFloatTimeDomainData() {} }; }
}
const handlers = new Map<string, Function>();
(globalThis as any).window = { AudioContext: FakeContext, addEventListener: (k: string, f: Function) => handlers.set(k, f), removeEventListener: (k: string) => handlers.delete(k) };
(globalThis as any).WebSocket = { OPEN: 1 };
const { VoiceCall, useVoice } = await import('../web/src/voice/call.ts');
const { voiceApi } = await import('../web/src/voice/api.ts');
const calls: any[] = [];
const make = () => { const c: any = new VoiceCall('sebby'); calls.push(c); c.sess = { callId: 'call', sampleRate: 24000 }; return c; };
voiceApi.end = async () => ({ ok: true });
afterEach(() => { for (const c of calls.splice(0)) c.end(); });

test('barge-in clears playback, cancels generation and ignores late interrupted audio', () => {
  const c = make(); let cleared = 0, pushed = 0; const sent: any[] = [];
  c.ws = { readyState: 1, send: (v: string) => sent.push(JSON.parse(v)), close() {} };
  c.player.push = () => pushed++; c.player.clear = () => cleared++;
  Object.defineProperty(c.player, 'playing', { get: () => true });
  c.handle({ type: 'response.created', response: { id: 'r1' } });
  c.handle({ type: 'input_audio_buffer.speech_started' });
  c.handle({ type: 'response.audio.delta', response_id: 'r1', delta: 'AAA=' });
  assert.equal(cleared, 1); assert.equal(pushed, 0);
  assert.ok(sent.some(e => e.type === 'response.cancel'));
});
test('late task acknowledgement after hangup does not restart polling or change call state', async () => {
  const c = make(); let resolve!: (r: any) => void;
  voiceApi.tool = () => new Promise(r => { resolve = r; });
  c.startTool('tool1', 'send_task', '{"request":"build"}');
  c.end(); resolve({ taskId: 'tool1', output: 'queued' });
  await new Promise(r => setImmediate(r));
  assert.equal(c.tasks.size, 0); assert.equal(c.checkTimer, null);
  assert.equal(useVoice.getState().status, 'idle');
});
test('result polling speaks each exact result once and ignores unrelated jobs', async () => {
  const c = make(); c.tasks.set('mine', 'my job'); const notes: string[] = [];
  c.queueNote = (s: string) => notes.push(s);
  voiceApi.work = async () => ({ jobs: [
    { id: 'unrelated', request: 'other job', status: 'completed', text: 'Wrong result' },
    { id: 'mine', request: 'my job', status: 'failed', text: 'Could not build' },
  ] });
  await c.checkTasks(); await c.checkTasks();
  assert.equal(notes.length, 1); assert.match(notes[0], /Status: failed/);
  assert.doesNotMatch(notes[0], /Wrong result/);
});
test('hangup releases microphone, playback, socket and audio context exactly once', () => {
  const c = make(); let stopped = 0, closed = 0, disposed = 0;
  c.mic = { stop: () => stopped++ };
  c.ws = { close: () => closed++ };
  c.player.dispose = () => disposed++;
  c.end(); c.end();
  assert.deepEqual([stopped, closed, disposed], [1, 1, 1]);
  assert.equal(c.ctx.closed, true);
});

test('microphone permission granted after hangup immediately stops the new stream', async () => {
  let grant!: (s: any) => void; let stopped = 0, sessions = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(r => { grant = r; }) } } });
  voiceApi.session = async () => { sessions++; throw new Error('must not run'); };
  const c = make(); c.sess = null;
  const starting = c.start(); c.end();
  grant({ getTracks: () => [{ stop: () => stopped++ }] });
  await starting;
  assert.equal(stopped, 1); assert.equal(sessions, 0);
  assert.equal(useVoice.getState().status, 'idle');
});
test('three lost task polls end the call without claiming completion', async () => {
  const c = make(); c.tasks.set('mine', 'build'); let stopped = 0;
  c.mic = { stop: () => stopped++ };
  voiceApi.work = async () => { throw new Error('offline'); };
  await c.checkTasks(); await c.checkTasks(); await c.checkTasks();
  assert.equal(stopped, 1); assert.equal(c.ended, true);
  assert.match(useVoice.getState().error ?? '', /submitted work may continue/);
});
test('approval notices are announced once while a job stays pending', async () => {
  const c = make(); c.tasks.set('mine', 'build'); const notes: string[] = [];
  c.queueNote = (s: string) => notes.push(s);
  voiceApi.work = async () => ({ awaiting: 'Review file changes', jobs: [{ id: 'mine', request: 'build', status: 'pending', text: '' }] });
  await c.checkTasks(); await c.checkTasks();
  assert.equal(notes.length, 1); assert.match(notes[0], /approval/);
  assert.equal(c.tasks.size, 1);
});
test('task results wait for the user to stop speaking before generating audio', () => {
  const c = make(); const sent: any[] = []; c.ready = true; c.userSpeaking = true;
  c.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)), close() {} };
  c.queueNote('Build failed'); assert.equal(sent.length, 0);
  c.handle({ type: 'input_audio_buffer.speech_stopped' });
  assert.deepEqual(sent.map(x => x.type), ['conversation.item.create', 'response.create']);
  assert.match(sent[0].item.content[0].text, /Build failed/);
});
