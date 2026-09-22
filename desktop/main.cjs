const { app, BrowserWindow, Menu, ipcMain, screen, shell, nativeTheme } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createWslgTopmostBridge } = require('./wslg-topmost.cjs')

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const i = arg.indexOf('=')
  return [arg.slice(2, i), arg.slice(i + 1)]
}))
const dshHome = path.resolve(args['dsh-home'] || path.join(app.getPath('home'), '.dsh'))
const dataRoot = path.join(dshHome, 'lokki-companion')
const stateFile = path.resolve(args['state-file'])
const settingsFile = path.resolve(args['settings-file'])
const libraryDir = path.resolve(args['library-dir'])
const pluginRoot = path.resolve(__dirname, '..')
const builtInRoot = path.join(pluginRoot, 'assets', 'pets')
const boundsFile = path.join(dataRoot, 'window.json')
const promptRequestsDir = path.join(dataRoot, 'input-requests')
const promptResultsDir = path.join(dataRoot, 'input-results')
const locales = Object.fromEntries(['en', 'zh'].map((language) => [
  language, JSON.parse(fsSync.readFileSync(path.join(__dirname, 'locales', language + '.json'), 'utf8')),
]))

let petWindow
let settingsWindow
let settings = { petId: 'lokki', size: 150, opacity: 100, alwaysOnTop: true, reducedMotion: false, language: 'en', themePreference: 'system' }
let snapshot = { state: 'idle', activeAgents: 0, totalAgents: 0, settings, libraryDir }
let pets = []
let discoverPets
let promptOpen = false
let pendingPromptRequest
const wslgPetTopmost = createWslgTopmostBridge()
const wslgSettingsTopmost = createWslgTopmostBridge({ windowTitle: 'Lokki Companion', hideFromTaskbar: false })

const electronData = path.join(dataRoot, 'electron-user-data')
fsSync.mkdirSync(electronData, { recursive: true, mode: 0o700 })
app.setPath('userData', electronData)
app.setName('Lokki Companion')
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault()
  })
})

function activeThemeIsDark() {
  return settings.themePreference === 'dark' || (settings.themePreference === 'system' && nativeTheme.shouldUseDarkColors)
}

function updateSettingsBackground() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setBackgroundColor(activeThemeIsDark() ? '#151517' : '#ffffff')
  }
}

function sendSnapshot() {
  const messages = locales[settings.language] || locales.en
  const publicPets = pets.map((pet) => ({
    id: pet.id,
    displayName: pet.displayName,
    description: settings.language === 'zh' ? (pet.descriptionZh || pet.description) : pet.description,
    mode: pet.mode,
    width: pet.width,
    height: pet.height,
    source: pet.source,
    url: pathToFileURL(pet.imagePath).href,
  }))
  const localizedSnapshot = { ...snapshot, settings, libraryDir, messages }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('lokki:snapshot', localizedSnapshot)
    petWindow.webContents.send('lokki:pets', publicPets)
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('lokki:snapshot', localizedSnapshot)
    settingsWindow.webContents.send('lokki:pets', publicPets)
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

async function refreshPets() {
  if (!discoverPets) return
  const result = await discoverPets(builtInRoot, libraryDir)
  pets = result.pets
  if (result.errors.length) console.warn('[lokki-companion] pet library: ' + result.errors.join('; '))
  if (!pets.some((pet) => pet.id === settings.petId)) settings.petId = pets.some((pet) => pet.id === 'lokki') ? 'lokki' : pets[0]?.id
  snapshot = { ...snapshot, settings }
  sendSnapshot()
}

function enforcePetZOrder(options) {
  if (!petWindow || petWindow.isDestroyed()) return
  const settingsVisible = settingsWindow
    && !settingsWindow.isDestroyed()
    && settingsWindow.isVisible()
    && !settingsWindow.isMinimized()
  const topmost = Boolean(settings.alwaysOnTop) && !settingsVisible
  petWindow.setAlwaysOnTop(topmost, 'floating')
  wslgPetTopmost.apply(topmost, options)
}

function enforceSettingsZOrder(options) {
  if (!settingsWindow || settingsWindow.isDestroyed()) return
  settingsWindow.setAlwaysOnTop(true, 'floating')
  settingsWindow.moveTop()
  wslgSettingsTopmost.apply(true, options)
}

function resizePetWindow() {
  if (!petWindow || petWindow.isDestroyed()) return
  const bounds = petWindow.getBounds()
  const centerX = bounds.x + bounds.width / 2
  const bottom = bounds.y + bounds.height
  const baseWidth = Math.round(settings.size + 48)
  const baseHeight = Math.round(settings.size * 1.08 + 78)
  const width = promptOpen ? Math.max(baseWidth, 360) : baseWidth
  const height = baseHeight + (promptOpen ? 112 : 0)
  petWindow.setBounds({ x: Math.round(centerX - width / 2), y: Math.round(bottom - height), width, height })
}

async function pollPromptResult() {
  if (!pendingPromptRequest || !petWindow || petWindow.isDestroyed()) return
  const requestId = pendingPromptRequest
  const result = await readJson(path.join(promptResultsDir, requestId + '.json'), null)
  if (pendingPromptRequest !== requestId || !result || result.requestId !== requestId) return
  pendingPromptRequest = undefined
  await fs.rm(path.join(promptResultsDir, requestId + '.json'), { force: true }).catch(() => {})
  petWindow.webContents.send('lokki:prompt-result', result)
}

async function createPetWindow() {
  const saved = await readJson(boundsFile, {})
  const width = Math.round(settings.size + 48)
  const height = Math.round(settings.size * 1.08 + 78)
  const area = screen.getPrimaryDisplay().workArea
  const x = Number.isFinite(saved.x) ? Math.min(Math.max(saved.x, area.x), area.x + area.width - width) : area.x + area.width - width - 30
  const y = Number.isFinite(saved.y) ? Math.min(Math.max(saved.y, area.y), area.y + area.height - height) : area.y + area.height - height - 60
  petWindow = new BrowserWindow({
    x, y, width, height, minWidth: 150, minHeight: 168, maxWidth: 380, maxHeight: 540,
    title: 'Lokki Companion Pet', frame: false, transparent: true, resizable: true, movable: true,
    alwaysOnTop: settings.alwaysOnTop, skipTaskbar: true, hasShadow: false,
    backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  petWindow.webContents.on('page-title-updated', () => enforcePetZOrder({ attempts: 6, delay: 180 }))
  petWindow.on('show', () => enforcePetZOrder({ attempts: 6, delay: 180 }))
  petWindow.on('blur', () => enforcePetZOrder({ attempts: 4, delay: 80 }))
  petWindow.on('restore', () => enforcePetZOrder({ attempts: 6, delay: 180 }))
  await petWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'pet' } })
  petWindow.showInactive()
  enforcePetZOrder({ attempts: 6, delay: 180 })
  petWindow.setBounds({ x, y, width, height })
  petWindow.on('moved', saveBounds)
  petWindow.on('resized', saveBounds)
  petWindow.on('closed', () => { petWindow = undefined })
  petWindow.webContents.on('context-menu', () => {
    const messages = locales[settings.language] || locales.en
    Menu.buildFromTemplate([
      { label: messages.settingsAction, click: () => openSettings() },
      { label: messages.nextPetAction, click: () => cyclePet() },
    ]).popup({ window: petWindow })
  })
}

let boundsTimer
function saveBounds() {
  if (!petWindow || petWindow.isDestroyed()) return
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    fs.mkdir(dataRoot, { recursive: true }).then(() => fs.writeFile(boundsFile, JSON.stringify(petWindow.getBounds()))).catch(() => {})
  }, 350)
}

async function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    enforceSettingsZOrder({ attempts: 6, delay: 0 })
    return
  }
  settingsWindow = new BrowserWindow({
    width: 480, height: 760, minWidth: 440, minHeight: 650, title: 'Lokki Companion',
    resizable: true, minimizable: true, focusable: true, show: false, alwaysOnTop: true,
    skipTaskbar: false, backgroundColor: activeThemeIsDark() ? '#151517' : '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  settingsWindow.on('show', () => enforceSettingsZOrder({ attempts: 6, delay: 120 }))
  settingsWindow.on('restore', () => enforceSettingsZOrder({ attempts: 6, delay: 120 }))
  settingsWindow.on('minimize', () => enforcePetZOrder({ attempts: 6, delay: 0 }))
  settingsWindow.on('hide', () => enforcePetZOrder({ attempts: 6, delay: 0 }))
  settingsWindow.on('closed', () => {
    settingsWindow = undefined
    enforcePetZOrder({ attempts: 6, delay: 0 })
  })
  await settingsWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'settings' } })
  settingsWindow.show()
  settingsWindow.focus()
  enforceSettingsZOrder({ attempts: 6, delay: 0 })
  sendSnapshot()
}

async function persistSettings(next) {
  settings = {
    ...settings,
    ...next,
    size: Math.max(88, Math.min(240, Number(next.size ?? settings.size))),
    opacity: Math.max(35, Math.min(100, Number(next.opacity ?? settings.opacity))),
    language: ['en', 'zh'].includes(next.language ?? settings.language) ? (next.language ?? settings.language) : settings.language,
    themePreference: ['system', 'light', 'dark'].includes(next.themePreference ?? settings.themePreference) ? (next.themePreference ?? settings.themePreference) : settings.themePreference,
  }
  snapshot = { ...snapshot, settings }
  await fs.mkdir(path.dirname(settingsFile), { recursive: true })
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
  updateSettingsBackground()
  if (petWindow && !petWindow.isDestroyed()) {
    enforcePetZOrder({ attempts: 4, delay: 80 })
    resizePetWindow()
  }
  sendSnapshot()
}

async function cyclePet() {
  if (!pets.length) return
  const index = pets.findIndex((pet) => pet.id === settings.petId)
  await persistSettings({ petId: pets[(index + 1) % pets.length].id })
}

ipcMain.handle('lokki:open-settings', openSettings)
ipcMain.handle('lokki:open-library', async () => {
  await fs.mkdir(libraryDir, { recursive: true })
  const message = await shell.openPath(libraryDir)
  if (message) console.warn('[lokki-companion] could not open pet folder: ' + message)
})
ipcMain.handle('lokki:rescan', refreshPets)
ipcMain.handle('lokki:set-setting', async (_event, key, value) => {
  if (!['petId', 'size', 'opacity', 'alwaysOnTop', 'reducedMotion', 'language', 'themePreference'].includes(key)) return false
  if (key === 'petId' && !pets.some((pet) => pet.id === value)) return false
  if (key === 'language' && !['en', 'zh'].includes(value)) return false
  if (key === 'themePreference' && !['system', 'light', 'dark'].includes(value)) return false
  await persistSettings({ [key]: value })
  return true
})
ipcMain.handle('lokki:next-pet', cyclePet)
ipcMain.handle('lokki:toggle-prompt', () => {
  promptOpen = !promptOpen
  resizePetWindow()
  return promptOpen
})
ipcMain.handle('lokki:send-prompt', async (_event, payload) => {
  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  const agentId = typeof payload?.agentId === 'string' ? payload.agentId : ''
  if (!text || text.length > 20000) throw new Error('Enter a message of up to 20,000 characters.')
  if (!snapshot.agents?.some((agent) => agent.id === agentId)) throw new Error('Choose an available DSH session.')
  if (pendingPromptRequest) throw new Error('A message is already being sent.')
  const requestId = randomUUID()
  await fs.mkdir(promptRequestsDir, { recursive: true, mode: 0o700 })
  const requestPath = path.join(promptRequestsDir, requestId + '.json')
  const temporaryPath = requestPath + '.tmp'
  await fs.writeFile(temporaryPath, JSON.stringify({ requestId, agentId, text }), { mode: 0o600 })
  await fs.rename(temporaryPath, requestPath)
  pendingPromptRequest = requestId
  return { requestId }
})
ipcMain.handle('lokki:close-pet', () => app.quit())
ipcMain.handle('lokki:close-settings', () => settingsWindow?.close())

nativeTheme.on('updated', () => {
  if (settings.themePreference === 'system') {
    updateSettingsBackground()
    sendSnapshot()
  }
})

app.whenReady().then(async () => {
  const petModule = await import('../src/pets.js')
  discoverPets = petModule.discoverPets
  settings = { ...settings, ...(await readJson(settingsFile, {})) }
  delete settings.showStatusBubble
  if (!['en', 'zh'].includes(settings.language)) settings.language = 'en'
  if (!['system', 'light', 'dark'].includes(settings.themePreference)) settings.themePreference = 'system'
  snapshot = { ...(await readJson(stateFile, snapshot)), settings, libraryDir }
  await refreshPets()
  await createPetWindow()
  sendSnapshot()
  if (args['capture-settings'] === 'true') await openSettings()
  setInterval(() => { void pollPromptResult() }, 250)
  if (args.capture) setTimeout(async () => {
    const target = args['capture-settings'] === 'true' ? settingsWindow : petWindow
    if (target && !target.isDestroyed()) await fs.writeFile(args.capture, (await target.webContents.capturePage()).toPNG())
  }, 1400)
  setInterval(async () => {
    const next = await readJson(stateFile, snapshot)
    if (next && next.updatedAt !== snapshot.updatedAt) {
      snapshot = { ...next, settings, libraryDir }
      sendSnapshot()
    }
  }, 450)
  setInterval(async () => { await refreshPets() }, 5000)
}).catch((error) => {
  console.error('[lokki-companion] startup failed: ' + (error.stack || error))
  app.quit()
})

app.on('window-all-closed', () => app.quit())
