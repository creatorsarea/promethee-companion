'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  init: () => ipcRenderer.invoke('studio:init'),
  tierImage: (tier) => ipcRenderer.invoke('studio:tierImage', tier),
  saveConfig: (patch) => ipcRenderer.invoke('studio:saveConfig', patch),
  publish: (payload) => ipcRenderer.invoke('studio:publish', payload),
  followState: () => ipcRenderer.invoke('studio:followState'),
  follow: () => ipcRenderer.invoke('studio:follow'),
  sceneBegin: (data) => ipcRenderer.invoke('studio:sceneBegin', data),
  sceneFrame: (i) => ipcRenderer.invoke('studio:sceneFrame', i),
  sceneEnd: () => ipcRenderer.invoke('studio:sceneEnd'),
});
