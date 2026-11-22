const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcRemote', {
  getState: () => ipcRenderer.invoke('get-state'),
  savePinSettings: (settings) => ipcRenderer.invoke('save-pin-settings', settings),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  copyUrl: () => ipcRenderer.invoke('copy-url'),
  pickFilesToShare: () => ipcRenderer.invoke('pick-files-to-share'),
  sharePaths: (paths) => ipcRenderer.invoke('share-paths', paths),
  unshareFile: (id) => ipcRenderer.invoke('unshare-file', id),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  hideToTray: () => ipcRenderer.send('hide-to-tray'),
  quitApp: () => ipcRenderer.send('quit-app'),
  onStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },
});
