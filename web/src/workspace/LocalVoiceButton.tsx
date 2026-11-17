import { useEffect } from 'react';
import { Mic } from 'lucide-react';
import { endCall, startWorkspaceCall, useVoice } from '../voice/call';

export function LocalVoiceButton() {
  const active = useVoice(state => state.workspaceCall && (state.status === 'live' || state.status === 'connecting'));

  useEffect(() => () => {
    if (useVoice.getState().workspaceCall) endCall();
    useVoice.setState({ lastWorkspaceCall: null });
  }, []);

  return (
    <button type="button" onClick={active ? endCall : startWorkspaceCall}>
      <Mic size={16} /> {active ? 'End live voice' : 'Start live voice'}
    </button>
  );
}
