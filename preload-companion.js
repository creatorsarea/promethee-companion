'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  init: () => ipcRenderer.invoke('companion:init'),
  onView: (cb) => ipcRenderer.on('companion:view', (_e, v) => cb(v)),
  hover: (over) => ipcRenderer.send('companion:hover', !!over),
  click: () => ipcRenderer.send('companion:click'),
  dragStart: () => ipcRenderer.send('companion:dragStart'),
  dragEnd: () => ipcRenderer.send('companion:dragEnd'),
});
