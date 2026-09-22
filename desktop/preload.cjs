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
  openSettings: () => ipcRenderer.invoke('lokki:open-settings'),
  openLibrary: () => ipcRenderer.invoke('lokki:open-library'),
  rescan: () => ipcRenderer.invoke('lokki:rescan'),
  setSetting: (key, value) => ipcRenderer.invoke('lokki:set-setting', key, value),
  nextPet: () => ipcRenderer.invoke('lokki:next-pet'),
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
