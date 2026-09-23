const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lokki', {
  onSnapshot(callback) {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('lokki:snapshot', listener)
    return () => ipcRenderer.removeListener('lokki:snapshot', listener)
  },
  onPets(callback) {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('lokki:pets', listener)
    return () => ipcRenderer.removeListener('lokki:pets', listener)
  },
  onDragFinished(callback) {
    const listener = () => callback()
    ipcRenderer.on('lokki:drag-finished', listener)
    return () => ipcRenderer.removeListener('lokki:drag-finished', listener)
  },
  openSettings: () => ipcRenderer.invoke('lokki:open-settings'),
  openLibrary: () => ipcRenderer.invoke('lokki:open-library'),
  rescan: () => ipcRenderer.invoke('lokki:rescan'),
  setSetting: (key, value) => ipcRenderer.invoke('lokki:set-setting', key, value),
  nextPet: () => ipcRenderer.invoke('lokki:next-pet'),
  wanderPet: (request) => ipcRenderer.invoke('lokki:wander-pet', request),
  stopWander: () => ipcRenderer.invoke('lokki:stop-wander'),
  beginPetDrag: (pointer) => ipcRenderer.send('lokki:drag-start', pointer),
  movePetToPointer: (pointer) => ipcRenderer.send('lokki:drag-pointer', pointer),
  endPetDrag: (pointer) => ipcRenderer.send('lokki:drag-end', pointer),
  closeSettings: () => ipcRenderer.invoke('lokki:close-settings'),
  togglePrompt: () => ipcRenderer.invoke('lokki:toggle-prompt'),
  sendPrompt: (payload) => ipcRenderer.invoke('lokki:send-prompt', payload),
  closePet: () => ipcRenderer.invoke('lokki:close-pet'),
  onPromptResult(callback) {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('lokki:prompt-result', listener)
    return () => ipcRenderer.removeListener('lokki:prompt-result', listener)
  },
})
