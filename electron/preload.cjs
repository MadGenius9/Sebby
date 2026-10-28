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
    discoverMcp: (id) => ipcRenderer.invoke("sebby:discover-mcp", id),
    mcpStatus: (id) => ipcRenderer.invoke("sebby:mcp-status", id),
    disconnectMcp: (id) => ipcRenderer.invoke("sebby:disconnect-mcp", id),
    startLocalUtility: (input) =>
      ipcRenderer.invoke("sebby:start-local-utility", input),
    reviewLocalUtility: (id) =>
      ipcRenderer.invoke("sebby:review-local-utility", id),
    notificationStatus: () => ipcRenderer.invoke("sebby:notification-status"),
    enableNotifications: () => ipcRenderer.invoke("sebby:enable-notifications"),
    disableNotifications: () =>
      ipcRenderer.invoke("sebby:disable-notifications"),
    pendingChangeReview: () =>
      ipcRenderer.invoke("sebby:pending-change-review"),
    respondChangeReview: (input) =>
      ipcRenderer.invoke("sebby:respond-change-review", input),
    providerStatus: (input) =>
      ipcRenderer.invoke("sebby:provider-status", input),
    listProviderProfiles: (input) =>
      ipcRenderer.invoke("sebby:list-provider-profiles", input),
    createProviderProfile: (input) =>
      ipcRenderer.invoke("sebby:create-provider-profile", input),
    updateProviderProfile: (input) =>
      ipcRenderer.invoke("sebby:update-provider-profile", input),
    selectProviderProfile: (input) =>
      ipcRenderer.invoke("sebby:select-provider-profile", input),
    saveProviderKey: (input) =>
      ipcRenderer.invoke("sebby:save-provider-key", input),
    removeProviderKey: (input) =>
      ipcRenderer.invoke("sebby:remove-provider-key", input),
    removeProviderProfile: (input) =>
      ipcRenderer.invoke("sebby:remove-provider-profile", input),
    testProviderProfile: (input) =>
      ipcRenderer.invoke("sebby:test-provider-profile", input),
    cancelProviderTest: (input) =>
      ipcRenderer.invoke("sebby:cancel-provider-test", input),
    startChat: (input) => ipcRenderer.invoke("sebby:start-chat", input),
    chatStatus: (input) => ipcRenderer.invoke("sebby:chat-status", input),
    cancelChat: (input) => ipcRenderer.invoke("sebby:cancel-chat", input),
    startAgent: (input) => ipcRenderer.invoke("sebby:start-agent", input),
    agentStatus: (input) => ipcRenderer.invoke("sebby:agent-status", input),
    cancelAgent: (input) => ipcRenderer.invoke("sebby:cancel-agent", input),
    reviewAgent: (input) => ipcRenderer.invoke("sebby:review-agent", input),
    getAppearance: (input) => ipcRenderer.invoke("sebby:get-appearance", input),
    saveAppearance: (input) =>
      ipcRenderer.invoke("sebby:save-appearance", input),
    onChatEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("sebby:chat-event", listener);
      return () => ipcRenderer.removeListener("sebby:chat-event", listener);
    },
    onProviderChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("sebby:provider-changed", listener);
      return () =>
        ipcRenderer.removeListener("sebby:provider-changed", listener);
    },
    thirdPartyNotices: () => ipcRenderer.invoke("sebby:third-party-notices"),
    previewStatus: () => ipcRenderer.invoke("sebby:preview-status"),
    openPreview: (input) => ipcRenderer.invoke("sebby:open-preview", input),
    closePreview: () => ipcRenderer.invoke("sebby:close-preview"),
    reviewedMcpStatus: (input) =>
      ipcRenderer.invoke("sebby:reviewed-mcp-status", input),
    saveMcpToken: (input) => ipcRenderer.invoke("sebby:save-mcp-token", input),
    removeMcpToken: (input) =>
      ipcRenderer.invoke("sebby:remove-mcp-token", input),
    discoverReviewedMcp: (input) =>
      ipcRenderer.invoke("sebby:discover-reviewed-mcp", input),
    grantMcpTool: (input) => ipcRenderer.invoke("sebby:grant-mcp-tool", input),
    revokeMcpTool: (input) =>
      ipcRenderer.invoke("sebby:revoke-mcp-tool", input),
    prepareMcpTool: (input) =>
      ipcRenderer.invoke("sebby:prepare-mcp-tool", input),
    invokeMcpTool: (input) =>
      ipcRenderer.invoke("sebby:invoke-mcp-tool", input),
    discardMcpTool: (input) =>
      ipcRenderer.invoke("sebby:discard-mcp-tool", input),
    cancelMcpTool: (input) =>
      ipcRenderer.invoke("sebby:cancel-mcp-tool", input),
    orchestrationStatus: (input) =>
      ipcRenderer.invoke("sebby:orchestration-status", input),
    createOrchestration: (input) =>
      ipcRenderer.invoke("sebby:create-orchestration", input),
    startOrchestrationStep: (input) =>
      ipcRenderer.invoke("sebby:start-orchestration-step", input),
    acceptOrchestrationStep: (input) =>
      ipcRenderer.invoke("sebby:accept-orchestration-step", input),
    finalizeOrchestration: (input) =>
      ipcRenderer.invoke("sebby:finalize-orchestration", input),
    acceptOrchestrationFinal: (input) =>
      ipcRenderer.invoke("sebby:accept-orchestration-final", input),
    cancelOrchestration: (input) =>
      ipcRenderer.invoke("sebby:cancel-orchestration", input),
    isolationStatus: (input) =>
      ipcRenderer.invoke("sebby:isolation-status", input),
    saveIsolationConfig: (input) =>
      ipcRenderer.invoke("sebby:save-isolation-config", input),
    prepareIsolationSnapshot: (input) =>
      ipcRenderer.invoke("sebby:prepare-isolation-snapshot", input),
    verifyIsolationSnapshot: (input) =>
      ipcRenderer.invoke("sebby:verify-isolation-snapshot", input),
    discardIsolationSnapshot: (input) =>
      ipcRenderer.invoke("sebby:discard-isolation-snapshot", input),
    publisherStatus: () => ipcRenderer.invoke("sebby:publisher-status"),
    grantGithubWrites: () => ipcRenderer.invoke("sebby:grant-github-writes"),
    revokeGithubWrites: () => ipcRenderer.invoke("sebby:revoke-github-writes"),
    prepareGithubPublication: (input) =>
      ipcRenderer.invoke("sebby:prepare-github-publication", input),
    publishGithubPublication: (input) =>
      ipcRenderer.invoke("sebby:publish-github-publication", input),
    discardGithubPublication: (input) =>
      ipcRenderer.invoke("sebby:discard-github-publication", input),
    cancelGithubPublication: () =>
      ipcRenderer.invoke("sebby:cancel-github-publication"),
    createGithubDraftPR: (input) =>
      ipcRenderer.invoke("sebby:create-github-draft-pr", input),
    checkGithubBuilds: (input) =>
      ipcRenderer.invoke("sebby:check-github-builds", input),
    githubStatus: () => ipcRenderer.invoke("sebby:github-status"),
    saveGithubConfig: (input) =>
      ipcRenderer.invoke("sebby:save-github-config", input),
    saveGithubToken: (input) =>
      ipcRenderer.invoke("sebby:save-github-token", input),
    removeGithubToken: () => ipcRenderer.invoke("sebby:remove-github-token"),
    readGithubMetadata: () => ipcRenderer.invoke("sebby:read-github-metadata"),
    readGithubTree: () => ipcRenderer.invoke("sebby:read-github-tree"),
    readGithubFile: (input) =>
      ipcRenderer.invoke("sebby:read-github-file", input),
    cancelGithubRead: () => ipcRenderer.invoke("sebby:cancel-github-read"),
    voiceStatus: () => ipcRenderer.invoke("sebby:voice-status"),
    beginVoiceCapture: (input) =>
      ipcRenderer.invoke("sebby:begin-voice-capture", input),
    endVoiceCapture: (id) => ipcRenderer.invoke("sebby:end-voice-capture", id),
    transcribeVoice: (input) =>
      ipcRenderer.invoke("sebby:transcribe-voice", input),
    cancelVoice: (id) => ipcRenderer.invoke("sebby:cancel-voice", id),
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
