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
  companions: () =>
    request<{
      companions: {
        id: string;
        label: string;
        rootName: string;
        writable: number;
        active: number;
        lastSeen: number;
        createdAt: number;
      }[];
    }>("/companions"),
  companionPair: () =>
    request<{ code: string; expiresAt: number }>("/companions/pairing", {
      method: "POST",
      body: "{}",
    }),
  revokeCompanion: (id: string) =>
    request<{ ok: boolean }>(`/companions/${id}/revoke`, {
      method: "POST",
      body: "{}",
    }),
  companionTask: (id: string, payload: unknown) =>
    request<{ id: string }>(`/companions/${id}/jobs`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  companionJob: (id: string, jobId: string) =>
    request<{ id: string; state: string; result: any }>(
      `/companions/${id}/jobs/${jobId}`,
    ),
  driveStatus: () =>
    request<{
      configured: boolean;
      connected: boolean;
      scope: string;
      pickerConfigured: boolean;
    }>("/drive/status"),
  driveConnect: () =>
    request<{ url: string }>("/drive/connect", { method: "POST", body: "{}" }),
  driveDisconnect: () =>
    request<{ connected: boolean; revoked: boolean }>("/drive/disconnect", {
      method: "POST",
      body: "{}",
    }),
  drivePicker: () =>
    request<{ accessToken: string; apiKey: string; appId: string }>(
      "/drive/picker-session",
      { method: "POST", body: "{}" },
    ),
  driveFiles: (pageToken?: string) =>
    request<{
      files: {
        id: string;
        name: string;
        mimeType: string;
        modifiedTime?: string;
      }[];
      nextPageToken: string | null;
    }>(
      `/drive/files${pageToken ? "?pageToken=" + encodeURIComponent(pageToken) : ""}`,
    ),
  driveReference: (id: string) =>
    request<{
      path: string;
      content: string;
      source: { name: string; fileId: string };
    }>(`/drive/files/${encodeURIComponent(id)}/reference`),
  driveExport: (projectId: string, revision: number) =>
    request<{ file: { id: string; name: string }; revision: number }>(
      "/drive/export",
      { method: "POST", body: JSON.stringify({ projectId, revision }) },
    ),
  search: (id: string, query: string) =>
    request<{
      revision: number;
      hits: import("@shared/workspace/schema").KnowledgeHit[];
    }>(`/projects/${id}/search?q=${encodeURIComponent(query)}`),
  reviewSourceZip: async (file: File, name: string, stripRoot: boolean) => {
    if (file.size > 4_000_000) throw new Error("Source ZIP must be under 4 MB");
    const response = await fetch(
      `/api/projects/import-source/review?${new URLSearchParams({ name, stripRoot: String(stripRoot) })}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/zip" },
        body: file,
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not inspect ZIP");
    return result as import("@shared/workspace/schema").SourceImportReview;
  },
  buildManifest: (runId: string) =>
    request<{ manifest: import("@shared/workspace/schema").BuildManifest }>(
      `/workspace/runs/${runId}/outputs`,
    ),
  buildPreview: (runId: string) =>
    request<import("@shared/workspace/schema").BuildPreview>(
      `/workspace/runs/${runId}/build-preview`,
    ),
  projectAgents: (id: string) =>
    request<{
      agents: {
        id: string;
        name: string;
        label: string;
        model: string | null;
        provider: string | null;
        binding: import("@shared/workspace/schema").ProjectBinding | null;
      }[];
    }>(`/workspace/${id}/agents`),
  bindAgent: (id: string, botId: string, allowRuns: boolean) =>
    request<{ binding: import("@shared/workspace/schema").ProjectBinding }>(
      `/workspace/${id}/agents/${botId}`,
      { method: "PUT", body: JSON.stringify({ allowRuns }) },
    ),
  unbindAgent: (id: string, botId: string) =>
    request<{ ok: boolean }>(`/workspace/${id}/agents/${botId}`, {
      method: "DELETE",
    }),
  proposals: (id: string) =>
    request<{
      proposals: import("@shared/workspace/schema").ProposalSummary[];
    }>(`/workspace/${id}/proposals`),
  reviewProposal: (id: string) =>
    request<import("@shared/workspace/schema").ProposalReview>(
      `/workspace/proposals/${id}`,
    ),
  applyProposal: (id: string, reviewHash: string) =>
    request<{ project: Project }>(`/workspace/proposals/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ reviewHash }),
    }),
  rejectProposal: (id: string) =>
    request<{ proposal: import("@shared/workspace/schema").ProposalSummary }>(
      `/workspace/proposals/${id}/reject`,
      { method: "POST", body: "{}" },
    ),
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
  runtime: (projectId?: string) =>
    request<import("@shared/workspace/schema").RunnerStatus>(
      `/workspace/runtime${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
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
