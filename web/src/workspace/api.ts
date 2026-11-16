import type {
  Project,
  ProjectSummary,
  ProjectDocument,
} from "@shared/workspace/schema";
export type {
  Project,
  ProjectSummary,
  ProjectDocument,
  SceneObject,
} from "@shared/workspace/schema";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}
export const workspaceApi = {
  list: () => request<{ projects: ProjectSummary[] }>("/projects"),
  create: (name: string, template: "blank" | "web" = "blank") =>
    request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, template }),
    }),
  importProject: (document: unknown) =>
    request<{ project: Project }>("/projects/import", {
      method: "POST",
      body: JSON.stringify(document),
    }),
  revisions: (id: string) =>
    request<{ revisions: { revision: number; createdAt: number }[] }>(
      `/projects/${id}/revisions`,
    ),
  diff: (id: string, from: number, to: number) =>
    request<{ diff: string; sceneChanged: boolean; nameChanged: boolean }>(
      `/projects/${id}/diff?from=${from}&to=${to}`,
    ),
  preview: (id: string, entry: string) =>
    request<{ html: string; warnings: string[]; revision: number }>(
      `/projects/${id}/preview?entry=${encodeURIComponent(entry)}`,
    ),
  runtime: () =>
    request<import("@shared/workspace/schema").RunnerStatus>(
      "/workspace/runtime",
    ),
  runs: (id: string) =>
    request<{ runs: import("@shared/workspace/schema").RunRecord[] }>(
      `/workspace/${id}/runs`,
    ),
  startRun: (id: string, revision: number, command: "build" | "test") =>
    request<{ run: import("@shared/workspace/schema").RunRecord }>(
      `/workspace/${id}/runs`,
      { method: "POST", body: JSON.stringify({ revision, command }) },
    ),
  cancelRun: (id: string) =>
    request<{ run: import("@shared/workspace/schema").RunRecord | null }>(
      `/workspace/runs/${id}/cancel`,
      { method: "POST", body: "{}" },
    ),
  open: (id: string) => request<{ project: Project }>(`/projects/${id}`),
  save: (p: Project) => {
    const body: ProjectDocument & { revision: number } = {
      name: p.name,
      files: p.files,
      scene: p.scene,
      revision: p.revision,
    };
    return request<{ project: Project }>(`/projects/${p.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },
};
export function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
