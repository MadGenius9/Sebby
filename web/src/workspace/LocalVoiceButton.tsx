import { DEFAULT_WORKSPACE_VOICE, VOICE_SPEEDS, WORKSPACE_VOICES, isWorkspaceVoicePreferences, type WorkspaceVoicePreferences } from '@shared/lib/voice-preferences';
import { useEffect, useRef, useState } from 'react';
import { Mic, MessageSquare, SlidersHorizontal } from 'lucide-react';
import { voiceApi, type LocalVoiceStatus } from '../voice/api';
import { endCall, previewWorkspaceVoice, startWorkspaceCall, useVoice, type WorkspaceVoiceBrief } from '../voice/call';
import type { Project } from './api';

const BRIEF_LIMIT = 4000;
const VOICE_PREFERENCES_KEY = 'sebby.workspace.voice';

function readPreferences(): WorkspaceVoicePreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(VOICE_PREFERENCES_KEY) ?? 'null');
    if (isWorkspaceVoicePreferences(value)) return value;
  } catch {
    // The current tab can still use voice when browser storage is unavailable.
  }
  return DEFAULT_WORKSPACE_VOICE;
}

function VoiceKeySettings() {
  const [status, setStatus] = useState<LocalVoiceStatus | null>(null);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const request = new AbortController();
    void voiceApi.localStatus(request.signal).then(next => {
      if (!request.signal.aborted) setStatus(next);
    }).catch(() => {
      if (!request.signal.aborted) setError('Could not check the saved key.');
    }).finally(() => {
      if (!request.signal.aborted) setLoading(false);
    });
    return () => request.abort();
  }, []);

  async function updateKey(remove: boolean) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = remove ? await voiceApi.removeLocalKey() : await voiceApi.saveLocalKey(key.trim());
      setStatus(next);
      setKey('');
      setMessage(remove ? 'Saved key removed.' : 'Key saved. Try Preview voice to check it.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the key.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="workspace-voice-key" onSubmit={event => {
      event.preventDefault();
      if (!loading && !saving && key.trim()) void updateKey(false);
    }}>
      <label htmlFor="workspace-xai-key">xAI API key</label>
      <input id="workspace-xai-key" type="password" autoComplete="new-password" spellCheck={false}
        maxLength={512} value={key} disabled={saving}
        placeholder={status?.source === 'saved' ? 'Paste a new key to replace it' : 'Paste your xAI API key'}
        onChange={event => setKey(event.target.value)} />
      <p className="workspace-voice-key-status">
        {status?.source === 'saved' ? 'Key saved on this computer.'
          : status?.source === 'environment' ? 'Using the key from your environment or .env.local.'
          : status ? 'Add a key to use live Grok voice.' : loading ? 'Checking voice setup…' : 'Key status unavailable.'}
      </p>
      <div className="source-import-actions">
        <button className="btn btn--secondary" type="submit" disabled={loading || saving || !key.trim()}>
          {status?.source === 'saved' ? 'Replace key' : 'Save key'}
        </button>
        {status?.source === 'saved' && (
          <button className="btn btn--secondary" type="button" disabled={saving} onClick={() => void updateKey(true)}>
            Remove saved key
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function LocalVoiceButton({ project }: { project: Project | null }) {
  const active = useVoice(state => state.workspaceCall && (state.status === 'live' || state.status === 'connecting'));
  const dialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const [draft, setDraft] = useState(preferences);
  const [preview, setPreview] = useState<WorkspaceVoiceBrief | null>(null);
  const [truncated, setTruncated] = useState(false);
  const sample = useRef<AbortController | null>(null);
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [sampleError, setSampleError] = useState('');

  function stopSample() {
    sample.current?.abort();
    sample.current = null;
    setSamplePlaying(false);
    setSampleError('');
  }

  async function toggleSample() {
    if (sample.current) {
      stopSample();
      return;
    }
    const request = new AbortController();
    sample.current = request;
    setSampleError('');
    setSamplePlaying(true);
    try {
      await previewWorkspaceVoice(draft, request.signal);
    } catch (error) {
      if (!request.signal.aborted) setSampleError(error instanceof Error ? error.message : 'Voice preview unavailable');
    } finally {
      if (sample.current === request) {
        sample.current = null;
        setSamplePlaying(false);
      }
    }
  }

  useEffect(() => () => {
    sample.current?.abort();
    if (useVoice.getState().workspaceCall) endCall();
    useVoice.setState({ lastWorkspaceCall: null });
  }, []);

  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal();
  }, [preview]);

  function reviewBrief() {
    if (!project) return;
    const brief = project.files.find(file => file.path.toLowerCase() === 'sebby.md')?.content.trim() ?? '';
    setPreview({ projectName: project.name, brief: brief.slice(0, BRIEF_LIMIT) });
    setTruncated(brief.length > BRIEF_LIMIT);
  }

  return (
    <>
      <button type="button" onClick={() => active ? endCall() : startWorkspaceCall(undefined, preferences)}>
        <Mic size={16} /> {active ? 'End live voice' : 'Start live voice'}
      </button>
      {project && !active && (
        <button type="button" onClick={reviewBrief}>
          <MessageSquare size={16} /> Talk about this project
        </button>
      )}
      {!active && (
        <button type="button" onClick={() => {
          setDraft(preferences);
          setSettingsOpen(true);
          settingsDialog.current?.showModal();
        }}>
          <SlidersHorizontal size={16} /> Voice settings
        </button>
      )}
      <dialog ref={settingsDialog} className="workspace-voice-dialog" aria-labelledby="workspace-voice-settings-title" onClose={() => {
        setSettingsOpen(false);
        stopSample();
      }}>
        <h2 id="workspace-voice-settings-title">Voice settings</h2>
        {settingsOpen && <VoiceKeySettings />}
        <form method="dialog" onSubmit={() => {
          setPreferences(draft);
          try {
            localStorage.setItem(VOICE_PREFERENCES_KEY, JSON.stringify(draft));
          } catch {
            // Keep the selection for this tab if persistence is unavailable.
          }
        }}>
          <label htmlFor="workspace-voice">Voice</label>
          <select id="workspace-voice" value={draft.voice} onChange={event => {
            const voice = WORKSPACE_VOICES.find(option => option === event.target.value);
            if (voice) {
              stopSample();
              setDraft({ ...draft, voice });
            }
          }}>
            {WORKSPACE_VOICES.map(voice => <option key={voice} value={voice}>{voice[0].toUpperCase() + voice.slice(1)}</option>)}
          </select>
          <label htmlFor="workspace-voice-speed">Speaking speed</label>
          <select id="workspace-voice-speed" value={draft.speed} onChange={event => {
            const speed = VOICE_SPEEDS.find(option => String(option) === event.target.value);
            if (speed !== undefined) {
              stopSample();
              setDraft({ ...draft, speed });
            }
          }}>
            {VOICE_SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
          <div className="source-import-actions">
            <button className="btn btn--secondary" type="button" onClick={() => void toggleSample()}>
              {samplePlaying ? 'Stop preview' : 'Preview voice'}
            </button>
            <button className="btn btn--primary" type="submit">Save voice settings</button>
            <button className="btn btn--secondary" type="button" onClick={() => settingsDialog.current?.close()}>Cancel</button>
          </div>
          {sampleError && <p role="alert">{sampleError}</p>}
        </form>
      </dialog>
      <dialog ref={dialog} className="workspace-voice-dialog" aria-labelledby="voice-brief-title" onClose={() => setPreview(null)}>
        {preview && (
          <form method="dialog" onSubmit={event => {
            event.preventDefault();
            dialog.current?.close();
            startWorkspaceCall({ ...preview, brief: preview.brief.trim() }, preferences);
          }}>
            <h2 id="voice-brief-title">Talk about {preview.projectName}</h2>
            <p>Grok will receive the project name and the text below when the call starts.</p>
            <label htmlFor="voice-brief">Project brief to share</label>
            <textarea
              id="voice-brief"
              value={preview.brief}
              maxLength={BRIEF_LIMIT}
              rows={9}
              placeholder="Add a short description of what you want to discuss."
              onChange={event => setPreview({ ...preview, brief: event.target.value })}
            />
            {truncated && <small>Showing the first {BRIEF_LIMIT.toLocaleString()} characters of the brief. Edit the text before sharing.</small>}
            <div className="source-import-actions">
              <button className="btn btn--primary" type="submit" disabled={active}>Share brief and start</button>
              <button className="btn btn--secondary" type="button" onClick={() => dialog.current?.close()}>Cancel</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
