import type { Project, ProjectSummary, ProjectDocument } from '@shared/workspace/schema';
export type { Project, ProjectSummary, ProjectDocument, SceneObject } from '@shared/workspace/schema';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
export const workspaceApi = {
  list: () => request<{ projects: ProjectSummary[] }>('/projects'),
  create: (name: string) => request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  open: (id: string) => request<{ project: Project }>(`/projects/${id}`),
  save: (p: Project) => {
    const body: ProjectDocument & { revision: number } = { name: p.name, files: p.files, scene: p.scene, revision: p.revision };
    return request<{ project: Project }>(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
  },
};
export function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
