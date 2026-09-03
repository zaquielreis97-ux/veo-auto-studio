const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, isolated API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectFiles: (options) => ipcRenderer.invoke('dialog:selectFiles', options),
  openPath: (folderPath) => ipcRenderer.invoke('shell:openPath', folderPath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  saveApiKeySecurely: (key) => ipcRenderer.invoke('secure:saveApiKey', key),
  getApiKeySecurely: () => ipcRenderer.invoke('secure:getApiKey'),
  onLog: (callback) => ipcRenderer.on('app:log', (event, value) => callback(value)),
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    isPackaged: () => ipcRenderer.invoke('updater:isPackaged'),
    onStatus: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },
  googleAuth: {
    start: () => ipcRenderer.invoke('google-auth:start'),
    getStatus: () => ipcRenderer.invoke('google-auth:status'),
    logout: () => ipcRenderer.invoke('google-auth:logout'),
    cancel: () => ipcRenderer.invoke('google-auth:cancel'),
    setConfig: (config) => ipcRenderer.invoke('google-auth:setConfig', config),
    verifyClientId: (clientId) => ipcRenderer.invoke('google-auth:verifyClientId', clientId),
  },
});
