const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sebby', Object.freeze({
  getState: () => ipcRenderer.invoke('sebby:get-state'),
  saveMemory: text => ipcRenderer.invoke('sebby:save-memory', text),
  savePersonality: value => ipcRenderer.invoke('sebby:save-personality', value),
  chooseWorkspace: () => ipcRenderer.invoke('sebby:choose-workspace'),
  listFiles: () => ipcRenderer.invoke('sebby:list-files'),
  readFile: relative => ipcRenderer.invoke('sebby:read-file', relative),
  createNote: input => ipcRenderer.invoke('sebby:create-note', input),
}));
