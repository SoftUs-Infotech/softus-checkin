'use strict'
/*
  The only door between the screens and the computer. The screens get exactly
  these functions as `window.softusDesktop` — no Node, no file system, no
  general IPC — and each one maps to one handler in main.cjs.
*/
const { contextBridge, ipcRenderer } = require('electron')

const info = ipcRenderer.sendSync('app:info')

// The window is closing: let the screens say what they must, then let it close.
const closingListeners = []
ipcRenderer.on('app:closing', async () => {
  for (const listener of closingListeners) {
    try {
      await listener()
    } catch {
      // Closing goes ahead regardless.
    }
  }
  ipcRenderer.send('app:closing-done')
})

contextBridge.exposeInMainWorld('softusDesktop', {
  version: info.version,
  platform: info.platform,
  arch: info.arch,
  osVersion: info.osVersion,
  permissions: () => ipcRenderer.invoke('permissions:status'),
  requestPermission: (kind) => ipcRenderer.invoke('permissions:request', kind),
  openPermissionSettings: (kind) => ipcRenderer.invoke('permissions:open', kind),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  captureScreens: (maxWidth) => ipcRenderer.invoke('capture:screens', maxWidth),
  startTracking: () => ipcRenderer.invoke('tracking:start'),
  stopTracking: () => ipcRenderer.invoke('tracking:stop'),
  captureHealth: () => ipcRenderer.invoke('capture:health'),
  reportCaptureLost: () => ipcRenderer.invoke('capture:lost'),
  attention: (message) => ipcRenderer.invoke('app:attention', message),
  takeActivity: () => ipcRenderer.invoke('tracking:take'),
  installUpdate: (file) => ipcRenderer.invoke('update:install', file),
  runSetup: () => ipcRenderer.invoke('setup:run'),
  onSetupOutput: (listener) => {
    const handler = (_event, text) => listener(text)
    ipcRenderer.on('setup:output', handler)
    return () => ipcRenderer.removeListener('setup:output', handler)
  },
  onUpdateProgress: (listener) => {
    const handler = (_event, progress) => listener(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  onClosing: (listener) => {
    closingListeners.push(listener)
  },
})
