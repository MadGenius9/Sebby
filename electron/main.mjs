import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, Workspace, validateNote } from './services.mjs';
import { allowedResource } from './resource-policy.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const dev = !app.isPackaged && process.argv.includes('--dev');
const appURL = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(directory, '../dist/index.html')).href;
let window;
const workspace = new Workspace();
let store;
let prompting = false;
const trusted = event => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== appURL) throw new Error('Untrusted request rejected.');
};
const register = (name, action) => ipcMain.handle(`sebby:${name}`, async (event, ...args) => {
  trusted(event);
  try { return await action(...args); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('That file already exists. Sebby will not overwrite it.');
    if (error.code) throw new Error('The local operation could not be completed. Check the folder permissions and try again.');
    throw new Error(error.message || 'The local operation failed.');
  }
});
async function createWindow() {
  window = new BrowserWindow({width: 1360, height: 900, minWidth: 900, minHeight: 660, title: 'Sebby', backgroundColor: '#0b1018', autoHideMenuBar: true,
    webPreferences: {preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  await window.loadURL(appURL);
}
app.setName('Sebby');
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  // Production has no network access. Development permits only the fixed local Vite server.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    allowedResource(details.url, path.join(directory, '../dist'), dev)
      .then(allowed => callback({cancel: !allowed}), () => callback({cancel: true}));
  });
  store = new Store(app.getPath('userData'));
  try { await store.load(); }
  catch (error) { dialog.showErrorBox('Sebby could not load local settings', `${error.message}\nCheck sebby-state.json in the application data folder before trying again.`); app.quit(); return; }
  register('get-state', () => store.state(workspace.root));
  register('save-memory', text => store.saveMemory(workspace.root, text));
  register('save-personality', value => store.savePersonality(value, workspace.root));
  register('choose-workspace', async () => {
    if (prompting) throw new Error('Finish the open dialog first.');
    prompting = true;
    try {
      const result = await dialog.showOpenDialog(window, {title: 'Choose a project folder for Sebby', properties: ['openDirectory'], buttonLabel: 'Use this project'});
      if (result.canceled || !result.filePaths[0]) return null;
      await workspace.select(result.filePaths[0]);
      return store.state(workspace.root);
    } finally { prompting = false; }
  });
  register('list-files', () => workspace.list());
  register('read-file', relative => workspace.read(relative));
  register('create-note', async input => {
    const note = validateNote(input);
    if (!workspace.root) throw new Error('Choose a project folder first.');
    if (prompting) throw new Error('Finish the open dialog first.');
    prompting = true;
    const selectedRoot = workspace.root;
    try {
      const result = await dialog.showMessageBox(window, {type: 'question', title: 'Create a local project note?', message: `Create ${note.name}?`, detail: `Folder: ${selectedRoot}\n\nThis creates one new text file (${Buffer.byteLength(note.content)} bytes). Existing files will never be overwritten.`, buttons: ['Cancel', 'Create file'], defaultId: 0, cancelId: 0, noLink: true});
      if (result.response !== 1) return {created: false};
      if (workspace.root !== selectedRoot) throw new Error('The selected workspace changed. Try again.');
      return await workspace.create(note);
    } finally { prompting = false; }
  });
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
