const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "sebby",
  Object.freeze({
    listTasks: (input) => ipcRenderer.invoke("sebby:list-tasks", input),
    createTask: (input) => ipcRenderer.invoke("sebby:create-task", input),
    cancelTask: (input) => ipcRenderer.invoke("sebby:cancel-task", input),
    retryTask: (input) => ipcRenderer.invoke("sebby:retry-task", input),
    removeTask: (input) => ipcRenderer.invoke("sebby:remove-task", input),
    listSkills: (input) => ipcRenderer.invoke("sebby:list-skills", input),
    importSkill: (input) => ipcRenderer.invoke("sebby:import-skill", input),
    removeSkill: (input) => ipcRenderer.invoke("sebby:remove-skill", input),
    listReminders: (input) => ipcRenderer.invoke("sebby:list-reminders", input),
    createReminder: (input) =>
      ipcRenderer.invoke("sebby:create-reminder", input),
    snoozeReminder: (input) =>
      ipcRenderer.invoke("sebby:snooze-reminder", input),
    dismissReminder: (input) =>
      ipcRenderer.invoke("sebby:dismiss-reminder", input),
    listConversations: (input) =>
      ipcRenderer.invoke("sebby:list-conversations", input),
    getConversation: (input) =>
      ipcRenderer.invoke("sebby:get-conversation", input),
    saveConversationDraft: (input) =>
      ipcRenderer.invoke("sebby:save-conversation-draft", input),
    removeConversation: (input) =>
      ipcRenderer.invoke("sebby:remove-conversation", input),
    previewEdit: (input) => ipcRenderer.invoke("sebby:preview-edit", input),
    discardEdit: (input) => ipcRenderer.invoke("sebby:discard-edit", input),
    applyEdit: (input) => ipcRenderer.invoke("sebby:apply-edit", input),
    undoEdit: (input) => ipcRenderer.invoke("sebby:undo-edit", input),
    planCommand: (input) => ipcRenderer.invoke("sebby:plan-command", input),
    discardCommand: (input) =>
      ipcRenderer.invoke("sebby:discard-command", input),
    startCommand: (input) => ipcRenderer.invoke("sebby:start-command", input),
    listCommandRuns: (input) =>
      ipcRenderer.invoke("sebby:list-command-runs", input),
    cancelCommand: (input) => ipcRenderer.invoke("sebby:cancel-command", input),
    configureGit: (input) => ipcRenderer.invoke("sebby:configure-git", input),
    listConnectors: () => ipcRenderer.invoke("sebby:list-connectors"),
    addConnector: (input) => ipcRenderer.invoke("sebby:add-connector", input),
    removeConnector: (id) => ipcRenderer.invoke("sebby:remove-connector", id),
    exportBackup: () => ipcRenderer.invoke("sebby:export-backup"),
    previewBackupImport: () =>
      ipcRenderer.invoke("sebby:preview-backup-import"),
    restoreBackup: (token) => ipcRenderer.invoke("sebby:restore-backup", token),
    listTeam: (input) => ipcRenderer.invoke("sebby:list-team", input),
    createTeamMember: (input) =>
      ipcRenderer.invoke("sebby:create-team-member", input),
    renameTeamMember: (input) =>
      ipcRenderer.invoke("sebby:rename-team-member", input),
    retireTeamMember: (input) =>
      ipcRenderer.invoke("sebby:retire-team-member", input),
    assignTeamTask: (input) =>
      ipcRenderer.invoke("sebby:assign-team-task", input),
    getState: () => ipcRenderer.invoke("sebby:get-state"),
    saveMemory: (text) => ipcRenderer.invoke("sebby:save-memory", text),
    savePersonality: (value) =>
      ipcRenderer.invoke("sebby:save-personality", value),
    chooseWorkspace: () => ipcRenderer.invoke("sebby:choose-workspace"),
    listFiles: () => ipcRenderer.invoke("sebby:list-files"),
    readFile: (relative) => ipcRenderer.invoke("sebby:read-file", relative),
    createNote: (input) => ipcRenderer.invoke("sebby:create-note", input),
  }),
);
