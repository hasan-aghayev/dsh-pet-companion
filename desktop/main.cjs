const { app, BrowserWindow, Menu, ipcMain, screen, shell, nativeTheme } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { createWslgTopmostBridge, readWslgScaleFactor } = require('./wslg-topmost.cjs')
const { getDragPosition } = require('./drag.cjs')
const { buildNativeDragScript, isWslgEnvironment } = require('./native-drag.cjs')
const { closePet } = require('./close-pet.cjs')
const { acquireSingleInstanceLock } = require('./single-instance.cjs')

// WSLg exposes both Wayland and X11, but this floating window needs X11's
// position and stacking controls to remain visible across Windows apps.
if (process.platform === 'linux' && process.env.WSL_DISTRO_NAME && process.env.WAYLAND_DISPLAY) {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
  const i = arg.indexOf('=')
  return [arg.slice(2, i), arg.slice(i + 1)]
}))
const dshHome = path.resolve(args['dsh-home'] || path.join(app.getPath('home'), '.dsh'))
const dataRoot = path.join(dshHome, 'pet-companion')
const stateFile = path.resolve(args['state-file'])
const settingsFile = path.resolve(args['settings-file'])
const libraryDir = path.resolve(args['library-dir'])
const pluginRoot = path.resolve(__dirname, '..')
const builtInRoot = path.join(pluginRoot, 'assets', 'pets')
const appIconPath = path.join(pluginRoot, 'assets', process.platform === 'win32' ? 'companion-mark.ico' : 'companion-mark.png')
const boundsFile = path.join(dataRoot, process.platform === 'win32' ? 'window-win32.json' : 'window.json')
const promptRequestsDir = path.join(dataRoot, 'input-requests')
const promptResultsDir = path.join(dataRoot, 'input-results')
const locales = Object.fromEntries(['en', 'zh'].map((language) => [
  language, JSON.parse(fsSync.readFileSync(path.join(__dirname, 'locales', language + '.json'), 'utf8')),
]))

let petWindow
let settingsWindow
let settings = { petId: 'lokki', size: 150, opacity: 100, alwaysOnTop: true, reducedMotion: false, wander: true, language: 'en', themePreference: 'system' }
let snapshot = { state: 'idle', activeAgents: 0, totalAgents: 0, settings, libraryDir }
let pets = []
let discoverPets
let promptOpen = false
let pendingPromptRequest
let wanderInterval
let finishWander
let pointerScaleFactor = 1
let petDragOrigin
let pendingPetDragPosition
let petDragUpdateTimer
let petDragMode = 'idle'
let lastPetDragPointer
let petDragEnding = false
let nativePetDragChild
let nativePetDragReady = false
let nativePetDragOutput = ''
const nativePetDragEnabled = isWslgEnvironment()
const wslgPetTopmost = createWslgTopmostBridge()
const wslgSettingsTopmost = createWslgTopmostBridge({ windowTitle: 'DSH Pet Companion Settings', hideFromTaskbar: false, removeFrame: false })

app.setName('DSH Pet Companion')
Menu.setApplicationMenu(null)
// Acquire the app-wide lock before setting profile-specific Electron storage.
const hasSingleInstanceLock = acquireSingleInstanceLock(app, () => {
  const profileId = createHash('sha256').update(dshHome.toLowerCase()).digest('hex').slice(0, 16)
  const electronData = process.platform === 'win32'
    ? path.join(app.getPath('userData'), profileId)
    : path.join(dataRoot, 'electron-user-data')
  fsSync.mkdirSync(electronData, { recursive: true, mode: 0o700 })
  app.setPath('userData', electronData)
})
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
    settingsWindow.setBackgroundColor(process.platform === 'win32' ? '#00000000' : (activeThemeIsDark() ? '#151517' : '#ffffff'))
  }
}

function sendSnapshot() {
  const messages = locales[settings.language] || locales.en
  const publicPets = pets.map((pet) => ({
    id: pet.id,
    displayName: settings.language === 'zh' ? (pet.displayNameZh || pet.displayName) : pet.displayName,
    description: settings.language === 'zh' ? (pet.descriptionZh || pet.description) : pet.description,
    mode: pet.mode,
    width: pet.width,
    height: pet.height,
    source: pet.source,
    url: pathToFileURL(pet.imagePath).href,
  }))
  const settingsOpen = Boolean(settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible() && !settingsWindow.isMinimized())
  const localizedSnapshot = { ...snapshot, settingsOpen, settings, libraryDir, messages }
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
  if (result.errors.length) console.warn('[dsh-pet-companion] pet library: ' + result.errors.join('; '))
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

function stopWander(result = { moved: false }) {
  clearInterval(wanderInterval)
  wanderInterval = undefined
  const finish = finishWander
  finishWander = undefined
  if (finish) finish(result)
}

function canWander() {
  return Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()
    && settings.wander !== false && !settings.reducedMotion && !promptOpen
    && Number(snapshot.activeAgents || 0) === 0
    && !(settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()))
}

function runWander(request = {}) {
  if (!canWander()) return Promise.resolve({ moved: false })
  stopWander()
  const direction = request.direction === 'left' ? 'left' : request.direction === 'right' ? 'right' : null
  if (!direction) return Promise.resolve({ moved: false })
  const bounds = petWindow.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width)
  const distance = Math.max(80, Math.min(320, Number(request.distance) || 180))
  const duration = Math.max(800, Math.min(2600, Number(request.duration) || 1700))
  const sign = direction === 'right' ? 1 : -1
  const targetX = Math.min(maxX, Math.max(workArea.x, bounds.x + sign * distance))
  if (targetX === bounds.x) return Promise.resolve({ moved: false })
  const actualDirection = direction

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearInterval(wanderInterval)
      wanderInterval = undefined
      if (finishWander === finish) finishWander = undefined
      resolve(result)
    }
    finishWander = finish
    wanderInterval = setInterval(() => {
      if (!canWander()) {
        finish({ moved: false })
        return
      }
      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      const x = Math.round(bounds.x + (targetX - bounds.x) * eased)
      petWindow.setPosition(x, bounds.y)
      if (progress >= 1) finish({ moved: true, direction: actualDirection })
    }, 30)
  })
}


function isPetDragSender(event) {
  return Boolean(petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents)
}

function clearPetDrag() {
  clearTimeout(petDragUpdateTimer)
  petDragUpdateTimer = undefined
  pendingPetDragPosition = undefined
  petDragOrigin = undefined
  lastPetDragPointer = undefined
  petDragEnding = false
  petDragMode = 'idle'
}

function completeNativePetDrag(result) {
  if (!petDragOrigin) return

  if (result?.ok && petWindow && !petWindow.isDestroyed()) {
    if (Number.isFinite(result.scale) && result.scale >= 0.5 && result.scale <= 5) pointerScaleFactor = result.scale
    const scale = pointerScaleFactor
    const pointer = {
      x: petDragOrigin.pointer.x + (result.left - result.startLeft) / scale,
      y: petDragOrigin.pointer.y + (result.top - result.startTop) / scale,
    }
    const workArea = screen.getDisplayMatching(petDragOrigin.bounds).workArea
    const position = getDragPosition(petDragOrigin, pointer, scale, workArea)
    if (position) petWindow.setPosition(position.x, position.y)
    saveBounds()
    petWindow.webContents.send('lokki:drag-finished')
    clearPetDrag()
    return
  }

  petDragMode = 'electron'
  if (lastPetDragPointer) updatePetDragPosition({ sender: petWindow?.webContents }, lastPetDragPointer)
  if (petDragEnding) {
    clearTimeout(petDragUpdateTimer)
    applyPendingPetDragPosition()
    petWindow?.webContents.send('lokki:drag-finished')
    clearPetDrag()
  }
}

function handleNativePetDragLine(line) {
  if (line === 'LOKKI_NATIVE_DRAG_READY') {
    nativePetDragReady = true
    return
  }
  if (!line.startsWith('{"ok":')) return
  let result
  try { result = JSON.parse(line) } catch {}
  completeNativePetDrag(result)
}

function handleNativePetDragHostExit(child) {
  if (nativePetDragChild !== child) return
  nativePetDragChild = undefined
  nativePetDragReady = false
  nativePetDragOutput = ''
  if (petDragOrigin) completeNativePetDrag({ ok: false })
}

function startNativePetDragHost() {
  if (!nativePetDragEnabled || nativePetDragChild) return false
  let child
  try {
    child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', buildNativeDragScript()], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return false
  }
  nativePetDragChild = child
  nativePetDragOutput = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    if (nativePetDragChild !== child) return
    nativePetDragOutput += chunk
    const lines = nativePetDragOutput.split(/\r?\n/)
    nativePetDragOutput = lines.pop() || ''
    for (const line of lines) handleNativePetDragLine(line.trim())
  })
  child.on('error', () => handleNativePetDragHostExit(child))
  child.on('close', () => handleNativePetDragHostExit(child))
  return true
}

function startNativePetDrag() {
  return Boolean(nativePetDragReady && nativePetDragChild && !nativePetDragChild.killed)
}

function beginPetDrag(event, payload = {}) {
  const start = payload.start || payload
  const current = payload.current || start
  if (!isPetDragSender(event) || !Number.isFinite(Number(start.x)) || !Number.isFinite(Number(start.y))
      || !Number.isFinite(Number(current.x)) || !Number.isFinite(Number(current.y))) return false
  stopWander()
  clearPetDrag()
  petDragOrigin = { bounds: petWindow.getBounds(), pointer: { x: Number(start.x), y: Number(start.y) } }
  lastPetDragPointer = { x: Number(current.x), y: Number(current.y) }
  pendingPetDragPosition = undefined
  petDragMode = startNativePetDrag() ? 'native' : 'electron'
  return true
}

function applyPendingPetDragPosition() {
  petDragUpdateTimer = undefined
  if (!petWindow || petWindow.isDestroyed() || !pendingPetDragPosition) return
  const position = pendingPetDragPosition
  pendingPetDragPosition = undefined
  petWindow.setPosition(position.x, position.y)
}

function updatePetDragPosition(event, pointer = {}) {
  if (!isPetDragSender(event) || !petDragOrigin) return false
  lastPetDragPointer = { x: Number(pointer.x), y: Number(pointer.y) }
  if (!Number.isFinite(lastPetDragPointer.x) || !Number.isFinite(lastPetDragPointer.y)) return false
  if (petDragMode === 'native-pending' || petDragMode === 'native') return true
  const workArea = screen.getDisplayMatching(petDragOrigin.bounds).workArea
  pendingPetDragPosition = getDragPosition(petDragOrigin, lastPetDragPointer, pointerScaleFactor, workArea)
  if (!pendingPetDragPosition) return false
  if (!petDragUpdateTimer) petDragUpdateTimer = setTimeout(applyPendingPetDragPosition, 16)
  return true
}

function endPetDrag(event, pointer = {}) {
  if (!isPetDragSender(event) || !petDragOrigin) return false
  updatePetDragPosition(event, pointer)
  if (petDragMode === 'native-pending' || petDragMode === 'native') {
    petDragEnding = true
    return true
  }
  clearTimeout(petDragUpdateTimer)
  applyPendingPetDragPosition()
  clearPetDrag()
  return true
}

function setPetVisible(visible) {
  if (!petWindow || petWindow.isDestroyed()) return
  if (!visible) {
    stopWander()
    if (petWindow.isVisible()) petWindow.hide()
    return
  }
  if (!petWindow.isVisible()) petWindow.showInactive()
  enforcePetZOrder({ attempts: 6, delay: 120 })
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
    title: 'DSH Pet Companion', frame: false, transparent: true, resizable: false, movable: true,
    icon: appIconPath,
    alwaysOnTop: settings.alwaysOnTop, skipTaskbar: true, hasShadow: false,
    backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  petWindow.webContents.on('page-title-updated', () => enforcePetZOrder({ attempts: 6, delay: 180 }))
  petWindow.on('show', () => enforcePetZOrder({ attempts: 6, delay: 180 }))
  petWindow.on('blur', () => enforcePetZOrder({ attempts: 4, delay: 80 }))
  petWindow.on('restore', () => enforcePetZOrder({ attempts: 6, delay: 180 }))
  await petWindow.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'pet' } })
  petWindow.setBounds({ x, y, width, height })
  if (settings.visible !== false) {
    petWindow.showInactive()
    enforcePetZOrder({ attempts: 6, delay: 180 })
  }
  petWindow.on('moved', saveBounds)
  petWindow.on('resized', saveBounds)
  petWindow.on('closed', () => { petWindow = undefined })
  petWindow.webContents.on('context-menu', () => {
    const messages = locales[settings.language] || locales.en
    Menu.buildFromTemplate([
      { label: messages.settingsAction, click: () => openSettings() },
      { label: messages.nextPetAction, click: () => cyclePet() },
      { type: 'separator' },
      { label: messages.closePet, click: () => { void closePetAndHide() } },
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
  stopWander()
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    enforceSettingsZOrder({ attempts: 6, delay: 0 })
    return
  }
  settingsWindow = new BrowserWindow({
    width: 520, height: 720, minWidth: 460, minHeight: 620, title: 'DSH Pet Companion Settings',
    icon: appIconPath,
    frame: false, transparent: true, resizable: true, minimizable: false, maximizable: false,
    focusable: true, show: false, alwaysOnTop: true, hasShadow: false,
    skipTaskbar: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  settingsWindow.on('show', () => {
    enforceSettingsZOrder({ attempts: 6, delay: 120 })
    sendSnapshot()
  })
  settingsWindow.on('restore', () => {
    enforceSettingsZOrder({ attempts: 6, delay: 120 })
    sendSnapshot()
  })
  settingsWindow.on('minimize', () => {
    enforcePetZOrder({ attempts: 6, delay: 0 })
    sendSnapshot()
  })
  settingsWindow.on('hide', () => {
    enforcePetZOrder({ attempts: 6, delay: 0 })
    sendSnapshot()
  })
  settingsWindow.on('closed', () => {
    settingsWindow = undefined
    sendSnapshot()
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
    wander: Boolean(next.wander ?? settings.wander),
    language: ['en', 'zh'].includes(next.language ?? settings.language) ? (next.language ?? settings.language) : settings.language,
    themePreference: ['system', 'light', 'dark'].includes(next.themePreference ?? settings.themePreference) ? (next.themePreference ?? settings.themePreference) : settings.themePreference,
  }
  snapshot = { ...snapshot, settings }
  await fs.mkdir(path.dirname(settingsFile), { recursive: true })
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
  if (!settings.wander || settings.reducedMotion) stopWander()
  updateSettingsBackground()
  if (petWindow && !petWindow.isDestroyed()) {
    enforcePetZOrder({ attempts: 4, delay: 80 })
    resizePetWindow()
  }
  sendSnapshot()
}

function closePetAndHide() {
  return closePet({
    persistSettings,
    hide: () => setPetVisible(false),
    onError: (error) => console.warn('[dsh-pet-companion] could not save hidden pet state: ' + error.message),
  })
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
  if (message) console.warn('[dsh-pet-companion] could not open pet folder: ' + message)
})
ipcMain.handle('lokki:rescan', refreshPets)
ipcMain.handle('lokki:set-setting', async (_event, key, value) => {
  if (!['petId', 'size', 'opacity', 'alwaysOnTop', 'reducedMotion', 'wander', 'language', 'themePreference'].includes(key)) return false
  if (key === 'petId' && !pets.some((pet) => pet.id === value)) return false
  if (key === 'language' && !['en', 'zh'].includes(value)) return false
  if (key === 'themePreference' && !['system', 'light', 'dark'].includes(value)) return false
  await persistSettings({ [key]: value })
  return true
})
ipcMain.handle('lokki:next-pet', cyclePet)
ipcMain.handle('lokki:wander-pet', (event, request) => {
  if (event.sender !== petWindow?.webContents) return { moved: false }
  return runWander(request)
})
ipcMain.handle('lokki:stop-wander', (event) => {
  if (event.sender !== petWindow?.webContents) return false
  stopWander()
  return true
})
ipcMain.on('lokki:drag-start', (event, pointer) => beginPetDrag(event, pointer))
ipcMain.on('lokki:drag-pointer', (event, pointer) => updatePetDragPosition(event, pointer))
ipcMain.on('lokki:drag-end', (event, pointer) => endPetDrag(event, pointer))
ipcMain.handle('lokki:toggle-prompt', () => {
  promptOpen = !promptOpen
  if (promptOpen) stopWander()
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
ipcMain.handle('lokki:close-pet', closePetAndHide)
ipcMain.handle('lokki:close-settings', () => settingsWindow?.close())

nativeTheme.on('updated', () => {
  if (settings.themePreference === 'system') {
    updateSettingsBackground()
    sendSnapshot()
  }
})

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    const petModule = await import('../src/pets.js')
    discoverPets = petModule.discoverPets
    settings = { ...settings, ...(await readJson(settingsFile, {})) }
    delete settings.showStatusBubble
    if (!['en', 'zh'].includes(settings.language)) settings.language = 'en'
    if (!['system', 'light', 'dark'].includes(settings.themePreference)) settings.themePreference = 'system'
    snapshot = { ...(await readJson(stateFile, snapshot)), settings, libraryDir }
    startNativePetDragHost()
    await refreshPets()
    await createPetWindow()
    void readWslgScaleFactor().then((scaleFactor) => { pointerScaleFactor = scaleFactor })
    sendSnapshot()
    if (args['capture-settings'] === 'true') await openSettings()
    setInterval(() => { void pollPromptResult() }, 250)
    if (args.capture) setTimeout(async () => {
      const target = args['capture-settings'] === 'true' ? settingsWindow : petWindow
      if (target && !target.isDestroyed()) await fs.writeFile(args.capture, (await target.webContents.capturePage()).toPNG())
    }, 1400)
    setInterval(async () => {
      const next = await readJson(stateFile, snapshot)
      const nextVisible = typeof next?.settings?.visible === 'boolean' ? next.settings.visible : settings.visible !== false
      if (next && (next.updatedAt !== snapshot.updatedAt || nextVisible !== (settings.visible !== false))) {
        const visibilityChanged = nextVisible !== (settings.visible !== false)
        settings = { ...settings, visible: nextVisible }
        snapshot = { ...next, settings, libraryDir }
        if (visibilityChanged) setPetVisible(nextVisible)
        if (Number(snapshot.activeAgents || 0) > 0 || settings.reducedMotion || !settings.wander) stopWander()
        sendSnapshot()
      }
    }, 450)
    setInterval(async () => { await refreshPets() }, 5000)
  }).catch((error) => {
    console.error('[dsh-pet-companion] startup failed: ' + (error.stack || error))
    app.quit()
  })
}

app.on('before-quit', () => {
  nativePetDragReady = false
  nativePetDragChild?.kill()
  nativePetDragChild = undefined
})

app.on('window-all-closed', () => app.quit())
