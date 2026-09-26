// Minimal, explicit bridge between the sandboxed game and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('riverboundNative', {
  platform: process.platform,
  storageRead: (key) => ipcRenderer.invoke('storage:read', key),
  storageWrite: (key, text) => ipcRenderer.invoke('storage:write', key, text),
  storageRemove: (key) => ipcRenderer.invoke('storage:remove', key),
  storageList: (prefix) => ipcRenderer.invoke('storage:list', prefix),
  savePhoto: (name, dataUrl) => ipcRenderer.invoke('photo:save', name, dataUrl),
  openPhotos: () => ipcRenderer.invoke('app:openPhotos'),
  setFullscreen: (on) => ipcRenderer.invoke('app:fullscreen', on),
  quit: () => ipcRenderer.invoke('app:quit'),
  log: (level, msg) => ipcRenderer.send('log', level, String(msg).slice(0, 4000)),
});
