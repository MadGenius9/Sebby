import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceWork } from '../server/src/voice-work.js';
const tick = () => new Promise(r => setImmediate(r));

test('voice jobs retain their own results when another job finishes first', async () => {
  const work = new VoiceWork();
  let finish!: (r: any) => void;
  work.submit('first', 'slow job', () => new Promise(r => { finish = r; }));
  work.submit('second', 'fast job', async () => ({ status: 'completed', text: 'Second result' }));
  await tick();
  assert.deepEqual(work.snapshot().map(j => j.status), ['pending', 'completed']);
  finish({ status: 'completed', text: 'First result' });
  await tick();
  assert.deepEqual(work.snapshot().map(j => j.text), ['First result', 'Second result']);
});
test('duplicate tool delivery executes once; conflicting reuse fails', async () => {
  const work = new VoiceWork(); let calls = 0;
  const run = async () => { calls++; return { status: 'completed' as const, text: 'Saved' }; };
  work.submit('id', 'save', run); work.submit('id', 'save', run);
  assert.throws(() => work.submit('id', 'delete', run));
  await tick(); assert.equal(calls, 1);
});
test('failure and cancellation stay distinguishable from success', async () => {
  const work = new VoiceWork();
  work.submit('failure', 'do work', async () => { throw new Error('secret provider error'); });
  work.submit('cancel', 'stop work', async () => ({ status: 'cancelled', text: 'Stopped' }));
  await tick();
  assert.equal(work.snapshot()[0].status, 'failed');
  assert.doesNotMatch(work.snapshot()[0].text, /secret/);
  assert.equal(work.snapshot()[1].status, 'cancelled');
});
test('call limits are enforced and returned snapshots cannot change jobs', () => {
  const work = new VoiceWork(); const run = async () => ({ status: 'completed' as const, text: 'ok' });
  assert.throws(() => work.submit('', 'bad', run));
  assert.throws(() => work.submit('long', 'a'.repeat(16001), run));
  for (let i = 0; i < 20; i++) work.submit(String(i), 'work', run);
  assert.throws(() => work.submit('21', 'work', run));
  work.snapshot()[0].text = 'forged'; assert.equal(work.snapshot()[0].text, '');
});
