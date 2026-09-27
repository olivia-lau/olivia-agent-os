const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentSetup', {
  chooseVault: () => ipcRenderer.invoke('setup:choose-vault'),
  save: settings => ipcRenderer.invoke('setup:save', settings)
});
