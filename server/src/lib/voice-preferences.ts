export const VOICE_SPEEDS = [0.7, 0.85, 1, 1.15, 1.3, 1.5] as const;
export const WORKSPACE_VOICES = ['luna', 'ara', 'eve', 'leo', 'rex', 'sal'] as const;

export type WorkspaceVoicePreferences = {
  voice: typeof WORKSPACE_VOICES[number];
  speed: typeof VOICE_SPEEDS[number];
};

export const DEFAULT_WORKSPACE_VOICE: WorkspaceVoicePreferences = { voice: 'luna', speed: 1 };

export function isWorkspaceVoicePreferences(value: unknown): value is WorkspaceVoicePreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { voice, speed } = value as Record<string, unknown>;
  return WORKSPACE_VOICES.some(option => option === voice) && VOICE_SPEEDS.some(option => option === speed);
}
