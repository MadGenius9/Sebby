import { useEffect, useRef, useState } from 'react';
import type { Row } from '@shared/types';
import { useVoice } from '../voice/call';
import { SpokenReplies } from '../voice/spoken-replies';

export function SpokenReplyControl({ rows, loaded }: { rows: Row[]; loaded: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const player = useRef<SpokenReplies | null>(null);
  const seen = useRef(new Set<string>());
  const callStatus = useVoice(state => state.status);
  const callActive = callStatus === 'connecting' || callStatus === 'live' || callStatus === 'ending';

  useEffect(() => {
    const stop = () => player.current?.stop();
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    const unsubscribe = useVoice.subscribe(state => {
      if (state.status === 'connecting' || state.status === 'live' || state.status === 'ending') stop();
    });
    return () => {
      unsubscribe();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
      player.current?.close();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    let latest: Row | undefined;
    for (const row of rows) {
      if (row.body.type !== 'message' || !row.body.spokenReply) continue;
      const key = row.generation + ':' + row.seq;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (!latest || row.updatedSeq > latest.updatedSeq) latest = row;
    }
    if (!latest || !enabled || !loaded || callActive || document.hidden || !document.hasFocus()) return;
    setError('');
    void player.current?.speak(latest).catch(error => setError(error.message));
  }, [rows, enabled, loaded, callActive]);

  function toggle() {
    setError('');
    if (enabled) {
      player.current?.close();
      player.current = null;
      setEnabled(false);
      return;
    }
    try {
      player.current = new SpokenReplies();
      setEnabled(true);
    } catch {
      setError('Audio is unavailable in this browser');
    }
  }

  return (
    <>
      <button type="button" className="share-btn" aria-pressed={enabled} disabled={!loaded}
        title="Read brief summaries of new replies in this chat using Grok voice" onClick={toggle}>
        {enabled ? 'Voice on' : 'Voice off'}
      </button>
      {error && <div className="toast" role="status">{error}</div>}
    </>
  );
}
