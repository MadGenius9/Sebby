import { useEffect, useRef, useState } from 'react';
import { Mic, MessageSquare } from 'lucide-react';
import { endCall, startWorkspaceCall, useVoice, type WorkspaceVoiceBrief } from '../voice/call';
import type { Project } from './api';

const BRIEF_LIMIT = 4000;

export function LocalVoiceButton({ project }: { project: Project | null }) {
  const active = useVoice(state => state.workspaceCall && (state.status === 'live' || state.status === 'connecting'));
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<WorkspaceVoiceBrief | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => () => {
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
      <button type="button" onClick={() => active ? endCall() : startWorkspaceCall()}>
        <Mic size={16} /> {active ? 'End live voice' : 'Start live voice'}
      </button>
      {project && !active && (
        <button type="button" onClick={reviewBrief}>
          <MessageSquare size={16} /> Talk about this project
        </button>
      )}
      <dialog ref={dialog} className="workspace-voice-dialog" aria-labelledby="voice-brief-title" onClose={() => setPreview(null)}>
        {preview && (
          <form method="dialog" onSubmit={event => {
            event.preventDefault();
            dialog.current?.close();
            startWorkspaceCall({ ...preview, brief: preview.brief.trim() });
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
