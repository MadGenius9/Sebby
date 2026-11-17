import { useState } from 'react';
import { documentSchema } from '@shared/workspace/schema';
import { useVoice, type WorkspaceCallTranscript } from '../voice/call';
import { download, type Project } from './api';

export function LocalVoiceTranscript({ project, busy, addToProject }: {
  project: Project | null;
  busy: boolean;
  addToProject: (project: Project, filename: string) => void;
}) {
  const transcript = useVoice(state => state.lastWorkspaceCall);
  const active = useVoice(state => state.workspaceCall && (state.status === 'connecting' || state.status === 'live'));
  if (!transcript || active) return null;

  return <Transcript key={transcript.endedAt} {...{ transcript, project, busy, addToProject }} />;
}

function Transcript({ transcript, project, busy, addToProject }: {
  transcript: WorkspaceCallTranscript;
  project: Project | null;
  busy: boolean;
  addToProject: (project: Project, filename: string) => void;
}) {
  const [error, setError] = useState('');
  const stamp = new Date(transcript.endedAt).toISOString();
  const filename = `sebby-call-${stamp.replace(/[:.]/g, '-')}.txt`;
  const content = `Sebby voice transcript\n${stamp}\n\n` + transcript.lines.map(({ role, text, final }) =>
    `${role === 'user' ? 'You' : 'Sebby'}${final ? '' : ' (partial)'}: ${text}`,
  ).join('\n\n') + '\n';
  const existing = project?.files.some(file => file.path.toLowerCase() === filename.toLowerCase());

  function attach() {
    if (!project || busy || existing) return;
    const files = [...project.files, { path: filename, content }];
    const parsed = documentSchema.safeParse({ name: project.name, files, scene: project.scene });
    if (!parsed.success || new TextEncoder().encode(JSON.stringify({ ...parsed.data, revision: project.revision })).length > 1_000_000) {
      setError('This transcript does not fit in the project. Download the text file to keep it.');
      return;
    }
    setError('');
    addToProject({ ...project, files }, filename);
  }

  return (
    <details className="workspace-call-transcript">
      <summary>Last voice transcript</summary>
      <pre aria-label="Voice transcript text">{content}</pre>
      <div className="source-import-actions">
        <button className="btn btn--secondary" type="button" onClick={() => download(filename, content, 'text/plain;charset=utf-8')}>Download transcript</button>
        {project && (
          <button className="btn btn--secondary" type="button" disabled={busy || existing} onClick={attach}>
            {existing ? 'Added to project' : 'Add transcript to project'}
          </button>
        )}
        <button className="btn btn--secondary" type="button" onClick={() => useVoice.setState({ lastWorkspaceCall: null })}>Clear transcript</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
