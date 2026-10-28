export type Personality = {
  warmth: "balanced" | "warm" | "direct";
  humor: boolean;
};
export type State = {
  memory: string;
  personality: Personality;
  workspace: null | { name: string; path: string };
  provider: { status: string };
  platform: string;
};
export type FileEntry = { path: string; size: number };
export interface Bridge {
  getState(): Promise<State>;
  saveMemory(text: string): Promise<State>;
  savePersonality(value: Personality): Promise<State>;
  chooseWorkspace(): Promise<State | null>;
  listFiles(): Promise<FileEntry[]>;
  readFile(path: string): Promise<{ path: string; content: string }>;
  createNote(value: {
    name: string;
    content: string;
  }): Promise<{ created: boolean; path?: string }>;
}
declare global {
  interface Window {
    sebby?: Bridge;
  }
}
const initial: State = {
  memory: "",
  personality: { warmth: "balanced", humor: true },
  workspace: null,
  provider: { status: "not-configured" },
  platform: "browser-preview",
};
function getPreview(): State {
  try {
    return {
      ...initial,
      ...JSON.parse(localStorage.getItem("sebby.preview") || "{}"),
      workspace: null,
      platform: "browser-preview",
    };
  } catch {
    return initial;
  }
}
async function save(value: Partial<State>) {
  const state = { ...getPreview(), ...value };
  localStorage.setItem("sebby.preview", JSON.stringify(state));
  return state;
}
export const desktop = !!window.sebby;
const implementation: Bridge = window.sebby ?? {
  getState: async () => getPreview(),
  saveMemory: (memory) => save({ memory }),
  savePersonality: (personality) => save({ personality }),
  chooseWorkspace: async () => {
    throw Error(
      "Folder access is available in the desktop app. Browser preview cannot access your files.",
    );
  },
  listFiles: async () => [],
  readFile: async () => {
    throw Error("Open the desktop app to read workspace files.");
  },
  createNote: async () => {
    throw Error("Open the desktop app to create a note.");
  },
};

let activeOperations = 0;
export function isBusy() {
  return activeOperations > 0;
}
export const bridge = new Proxy(implementation, {
  get(target, key) {
    const method = target[key as keyof Bridge];
    return async (...args: unknown[]) => {
      activeOperations++;
      try {
        return await (method as (...a: unknown[]) => Promise<unknown>)(...args);
      } finally {
        activeOperations--;
      }
    };
  },
}) as Bridge;

export type Task = {
  kind?: string;
  result?: string | null;
  id: string;
  title: string;
  prompt: string;
  role: "planner" | "coder" | "reviewer" | "researcher";
  status: string;
  workspace: string | null;
  logs: { at: string; message: string; level: string }[];
};
export type Skill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category: string;
  origin: string;
  trust: string;
  readOnly: boolean;
};
export type Reminder = {
  id: string;
  title: string;
  dueAt: number;
  status: string;
};
export type Conversation = {
  id: string;
  title: string;
  draft?: string;
  updatedAt: number;
  messageCount?: number;
  messages?: { id: string; role: string; text: string; status: string }[];
};
export interface LocalFeatures {
  listTasks(): Promise<Task[]>;
  createTask(input: {
    title: string;
    prompt: string;
    role: string;
  }): Promise<Task>;
  cancelTask(id: string): Promise<Task>;
  retryTask(id: string): Promise<Task>;
  removeTask(id: string): Promise<{ removed: boolean }>;
  listSkills(): Promise<Skill[]>;
  importSkill(input: {
    id: string;
    name: string;
    description: string;
    instructions: string;
  }): Promise<Skill>;
  removeSkill(id: string): Promise<{ removed: boolean }>;
  listReminders(): Promise<Reminder[]>;
  createReminder(input: { title: string; dueAt: number }): Promise<Reminder>;
  snoozeReminder(input: { id: string; dueAt: number }): Promise<Reminder>;
  dismissReminder(id: string): Promise<Reminder>;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation>;
  saveConversationDraft(input: {
    id?: string;
    title: string;
    text: string;
  }): Promise<Conversation>;
  removeConversation(id: string): Promise<{ removed: boolean }>;
}
export const local: LocalFeatures | null = desktop
  ? (window.sebby as Bridge & LocalFeatures)
  : null;
export type EditProposal = {
  id: string;
  path: string;
  kind: string;
  beforeHash: string | null;
  afterHash: string;
  diff: {
    text: string;
    truncated: boolean;
    removedLines: number;
    addedLines: number;
  };
};
export type CommandPlan = {
  id: string;
  display: string;
  warning: string;
  scripts: Record<string, string> | null;
};
export type CommandRun = {
  id: string;
  command: string;
  status: string;
  output?: string;
  error?: string;
  exitCode?: number;
  timedOut?: boolean;
  cancelled?: boolean;
  truncated?: boolean;
};
export interface DevelopmentBridge {
  previewEdit(input: {
    path: string;
    content: string;
    expectedHash?: string | null;
  }): Promise<EditProposal>;
  discardEdit(id: string): Promise<unknown>;
  applyEdit(id: string): Promise<{ applied: boolean; id?: string }>;
  undoEdit(id: string): Promise<{ undone: boolean }>;
  planCommand(name: string): Promise<CommandPlan>;
  discardCommand(id: string): Promise<unknown>;
  startCommand(id: string): Promise<{ id: string }>;
  listCommandRuns(): Promise<CommandRun[]>;
  cancelCommand(id: string): Promise<{ cancelled: boolean }>;
  configureGit(): Promise<{ configured: boolean }>;
}
export const development: DevelopmentBridge | null = desktop
  ? (window.sebby as Bridge & DevelopmentBridge)
  : null;
export type Connector = {
  id: string;
  name: string;
  type: "github" | "mcp";
  url: string;
  requestedScopes: string[];
  status: string;
  enabled: false;
};
export interface ConnectorsBridge {
  listConnectors(): Promise<Connector[]>;
  addConnector(input: {
    name: string;
    type: string;
    url: string;
  }): Promise<Connector>;
  removeConnector(id: string): Promise<{ removed: boolean }>;
}
export const connectors: ConnectorsBridge | null = desktop
  ? (window.sebby as Bridge & ConnectorsBridge)
  : null;
export type BackupPreview = {
  token: string;
  summary: { name: string; bytes: number }[];
  warnings: string[];
};
export interface BackupBridge {
  exportBackup(): Promise<{ exported: boolean }>;
  previewBackupImport(): Promise<BackupPreview | null>;
  restoreBackup(
    token: string,
  ): Promise<{ restored: boolean; restartRequired: boolean }>;
}
export const backups: BackupBridge | null = desktop
  ? (window.sebby as Bridge & BackupBridge)
  : null;
export type TeamMember = {
  id: string;
  name: string;
  nameOrigin: string;
  role: string;
  specialty: string;
  job: string;
  status: string;
  assignedTaskId: string | null;
};
export interface TeamBridge {
  listTeam(): Promise<TeamMember[]>;
  createTeamMember(input: { role: string; job: string }): Promise<TeamMember>;
  renameTeamMember(input: { id: string; name: string }): Promise<TeamMember>;
  retireTeamMember(id: string): Promise<TeamMember | null>;
  assignTeamTask(input: {
    id: string;
    taskId: string | null;
  }): Promise<TeamMember>;
}
export const team: TeamBridge | null = desktop
  ? (window.sebby as Bridge & TeamBridge)
  : null;
export type McpSnapshot = {
  connectorId: string;
  status: string;
  checkedAt: number | null;
  tools: { name: string; description: string }[];
  protocolVersion?: string;
  truncated?: boolean;
  error?: string;
};
export interface DiscoveryBridge {
  discoverMcp(id: string): Promise<McpSnapshot>;
  mcpStatus(id: string): Promise<McpSnapshot>;
  disconnectMcp(id: string): Promise<McpSnapshot>;
}
export const discovery: DiscoveryBridge | null = desktop
  ? (window.sebby as Bridge & DiscoveryBridge)
  : null;

export interface UtilityBridge {
  startLocalUtility(input: {
    kind: "workspace-inventory" | "project-brief";
    memberId?: string;
  }): Promise<{ started: boolean; runId?: string; task?: Task }>;
  reviewLocalUtility(id: string): Promise<{ reviewed: boolean; task: Task }>;
}
export const utilities: UtilityBridge | null = desktop
  ? (window.sebby as Bridge & UtilityBridge)
  : null;
export type NotificationStatus = {
  supported: boolean;
  enabled: boolean;
  busy: boolean;
  lastError: string | null;
  lastCheckedAt: number | null;
};
export interface NotificationBridge {
  notificationStatus(): Promise<NotificationStatus>;
  enableNotifications(): Promise<NotificationStatus>;
  disableNotifications(): Promise<NotificationStatus>;
}
export const notifications: NotificationBridge | null = desktop
  ? (window.sebby as Bridge & NotificationBridge)
  : null;
export type PendingChange = {
  id: string;
  kind: string;
  path: string;
  workspace: string;
  operation: string;
  afterHash: string;
  diff: string;
  removedLines: number;
  addedLines: number;
};
export interface ChangeReviewBridge {
  pendingChangeReview(): Promise<PendingChange | null>;
  respondChangeReview(input: {
    id: string;
    accepted: boolean;
  }): Promise<{ acknowledged: boolean }>;
}
export const changeReviews: ChangeReviewBridge | null = desktop
  ? (window.sebby as Bridge & ChangeReviewBridge)
  : null;
