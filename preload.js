'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  init: () => ipcRenderer.invoke('studio:init'),
  live: () => ipcRenderer.invoke('studio:live'),
  foreground: () => ipcRenderer.invoke('studio:foreground'),
  tierImage: (tier) => ipcRenderer.invoke('studio:tierImage', tier),
  saveConfig: (patch) => ipcRenderer.invoke('studio:saveConfig', patch),
  publish: (payload) => ipcRenderer.invoke('studio:publish', payload),
});
