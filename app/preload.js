'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {}
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('mornye', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  setPetConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  liveCommand: (command, target) => ipcRenderer.invoke('live:command', command, target),
  openDataFolder: () => ipcRenderer.invoke('app:openData'),
  setClickThrough: (enabled) => ipcRenderer.send('pet:clickThrough', Boolean(enabled)),
  setLocked: (locked) => ipcRenderer.invoke('pet:lock', Boolean(locked)),
  quit: () => ipcRenderer.send('pet:quit'),
  onInitialState: (callback) => subscribe('state:initial', callback),
  onConfigChanged: (callback) => subscribe('config:changed', callback),
  onLockChanged: (callback) => subscribe('lock:changed', callback),
  onLiveEvent: (callback) => subscribe('live:event', callback),
}))
