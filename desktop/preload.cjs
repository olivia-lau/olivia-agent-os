const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentSetup', {
  chooseVault: () => ipcRenderer.invoke('setup:choose-vault'),
  verifyGithub: input => ipcRenderer.invoke('setup:verify-github', input),
  save: settings => ipcRenderer.invoke('setup:save', settings)
});
