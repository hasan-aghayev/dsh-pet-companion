const mode = new URLSearchParams(location.search).get('mode') || 'pet'
const petView = document.querySelector('#pet-view')
const settingsView = document.querySelector('#settings-view')
let snapshot = { state: 'idle', activeAgents: 0, totalAgents: 0, settings: { language: 'en', themePreference: 'system' }, messages: {} }
let pets = []
let frameTimer
let frame = 0
let currentState = 'idle'
let currentPet
let animationKey = ''
let promptBusy = false
document.body.dataset.mode = mode

const englishFallback = {
  appTitle: 'Lokki Companion', settingsTitle: 'Lokki settings', settingsShortcut: 'Open settings',
  pet: 'Pet', builtIn: 'built-in', animatedPetDescription: 'Animated Hatch-Pet v2 atlas.',
  portraitPetDescription: 'Still portrait with a gentle breathing effect.', size: 'Size', opacity: 'Opacity',
  language: 'Language', appearance: 'Appearance', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System',
  keepOnTop: 'Keep above other windows', reducedMotion: 'Reduce motion',
  library: 'Pet library', libraryDescription: 'Add pet folders here to grow your collection.',
  openFolder: 'Open folder', refresh: 'Refresh', localFiles: 'Local files · messages stay in DSH',
  libraryPathFallback: 'DSH user folder', petCount: '{count} pets', onePet: '1 pet',
  settingsAction: 'Settings', nextPetAction: 'Next pet', pixels: 'px', percent: '%',
  typeMessage: 'Type a message', closePet: 'Close Lokki',
  inputPlaceholder: 'Write a message · Enter to send', sending: 'Sending…',
  sent: 'Message added to the session.', noSessions: 'No live DSH sessions.',
}

function t(key, values = {}) {
  let message = snapshot.messages?.[key] || englishFallback[key] || key
  for (const [name, value] of Object.entries(values)) message = message.replace('{' + name + '}', String(value))
  return message
}

function applyLocale() {
  const language = snapshot.settings?.language === 'zh' ? 'zh' : 'en'
  document.documentElement.lang = language
  document.title = mode === 'pet' ? 'Lokki Companion Pet' : t('appTitle')
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n)
  const controls = [
    ['#settings-shortcut', 'settingsShortcut'], ['#input-shortcut', 'typeMessage'], ['#close-shortcut', 'closePet'],
  ]
  for (const [selector, key] of controls) {
    const button = document.querySelector(selector)
    button.title = t(key)
    button.setAttribute('aria-label', t(key))
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder)
  document.querySelector('#sprite').setAttribute('aria-label', 'Lokki')
}

function applyTheme() {
  const preference = snapshot.settings?.themePreference || 'system'
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || (preference === 'system' && systemDark)
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark)
  document.body.toggleAttribute('data-ds-dark-theme', dark)
}

const animations = {
  idle: { row: 0, ms: [280, 110, 110, 140, 140, 320] },
  waving: { row: 3, ms: [140, 140, 140, 280] },
  jumping: { row: 4, ms: [140, 140, 140, 140, 280] },
  failed: { row: 5, ms: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, ms: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, ms: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, ms: [150, 150, 150, 150, 150, 280] },
}

function drawFrame() {
  if (!currentPet || currentPet.mode !== 'atlas-v2') return
  const animation = animations[currentState] || animations.idle
  const column = frame % animation.ms.length
  const cellWidth = currentPet.width / 8
  const cellHeight = currentPet.height / 11
  const scale = Number(snapshot.settings?.size || 150) / cellWidth
  const sprite = document.querySelector('#sprite')
  sprite.style.width = (cellWidth * scale) + 'px'
  sprite.style.height = (cellHeight * scale) + 'px'
  sprite.style.backgroundImage = 'url("' + currentPet.url + '")'
  sprite.style.backgroundSize = (currentPet.width * scale) + 'px ' + (currentPet.height * scale) + 'px'
  sprite.style.backgroundPosition = (-column * cellWidth * scale) + 'px ' + (-animation.row * cellHeight * scale) + 'px'
  sprite.style.opacity = String(Number(snapshot.settings?.opacity || 100) / 100)
}

function animate() {
  clearTimeout(frameTimer)
  if (!currentPet || currentPet.mode !== 'atlas-v2') return
  drawFrame()
  const animation = animations[currentState] || animations.idle
  const delay = snapshot.settings?.reducedMotion ? 1100 : animation.ms[frame % animation.ms.length]
  frame = (frame + 1) % animation.ms.length
  frameTimer = setTimeout(animate, delay)
}

function renderPet() {
  if (mode !== 'pet') return
  applyLocale()
  applyTheme()
  currentPet = pets.find((pet) => pet.id === snapshot.settings?.petId) || pets.find((pet) => pet.id === 'lokki') || pets[0]
  if (!currentPet) return
  const active = Number(snapshot.activeAgents || 0)
  const atlas = currentPet.mode === 'atlas-v2'
  document.querySelector('#sprite').hidden = !atlas
  document.querySelector('#portrait').hidden = atlas
  if (atlas) {
    const nextState = active ? 'running' : 'idle'
    const nextKey = currentPet.id + ':' + nextState
    if (nextKey !== animationKey) {
      currentState = nextState
      animationKey = nextKey
      frame = 0
      animate()
    } else drawFrame()
  } else {
    const image = document.querySelector('#portrait-image')
    image.src = currentPet.url
    image.style.opacity = String(Number(snapshot.settings?.opacity || 100) / 100)
    const size = Number(snapshot.settings?.size || 150)
    document.querySelector('#portrait').style.width = size + 'px'
    document.querySelector('#portrait').style.height = (size * 1.08) + 'px'
    image.style.animationPlayState = snapshot.settings?.reducedMotion ? 'paused' : 'running'
  }
}

function setSetting(key, value) { void window.lokki.setSetting(key, value) }

function renderSettings() {
  if (mode !== 'settings') return
  applyLocale()
  applyTheme()
  const settings = snapshot.settings || {}
  document.querySelector('#language').value = settings.language || 'en'
  for (const button of document.querySelectorAll('.theme-option')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === (settings.themePreference || 'system')))
  }
  const select = document.querySelector('#pet-select')
  const signature = (settings.language || 'en') + ':' + pets.map((pet) => pet.id).join('|')
  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature
    select.replaceChildren(...pets.map((pet) => {
      const option = document.createElement('option')
      option.value = pet.id
      option.textContent = pet.displayName + (pet.source === 'built-in' ? ' · ' + t('builtIn') : '')
      return option
    }))
  }
  select.value = settings.petId || 'lokki'
  const pet = pets.find((item) => item.id === select.value)
  document.querySelector('#pet-description').textContent = pet?.description || (pet?.mode === 'portrait' ? t('portraitPetDescription') : t('animatedPetDescription'))
  for (const [id, key] of [['size', 'size'], ['opacity', 'opacity']]) {
    const input = document.querySelector('#' + id)
    input.value = String(settings[key] ?? (key === 'size' ? 150 : 100))
    document.querySelector('#' + id + '-value').textContent = input.value + (key === 'opacity' ? t('percent') : ' ' + t('pixels'))
  }
  document.querySelector('#always-on-top').checked = settings.alwaysOnTop !== false
  document.querySelector('#reduced-motion').checked = Boolean(settings.reducedMotion)
  document.querySelector('#library-path').textContent = snapshot.libraryDir || t('libraryPathFallback')
  const count = pets.length
  document.querySelector('#pet-count').textContent = count === 1 ? t('onePet') : t('petCount', { count })
}

window.lokki.onSnapshot((next) => {
  snapshot = next || snapshot
  if (mode === 'pet') renderPet()
  else renderSettings()
})
window.lokki.onPets((next) => {
  pets = next || []
  if (mode === 'pet') renderPet()
  else renderSettings()
})

document.querySelector('#settings-shortcut').addEventListener('click', () => void window.lokki.openSettings())
document.querySelector('#close-shortcut').addEventListener('click', () => void window.lokki.closePet())
document.querySelector('#input-shortcut').addEventListener('click', async () => {
  const isOpen = await window.lokki.togglePrompt()
  const panel = document.querySelector('#prompt-panel')
  panel.hidden = !isOpen
  document.querySelector('#input-shortcut').setAttribute('aria-expanded', String(isOpen))
  document.querySelector('#pet-view').dataset.promptOpen = String(isOpen)
  if (isOpen) requestAnimationFrame(() => document.querySelector('#prompt-text').focus())
})
document.querySelector('#prompt-text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    document.querySelector('#prompt-panel').requestSubmit()
  }
})
document.querySelector('#prompt-panel').addEventListener('submit', async (event) => {
  event.preventDefault()
  const input = document.querySelector('#prompt-text')
  const message = input.value.trim()
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : []
  const agentId = agents.some(({ id }) => id === snapshot.preferredAgentId)
    ? snapshot.preferredAgentId
    : agents.at(-1)?.id
  if (!message || promptBusy) return
  if (!agentId) {
    document.querySelector('#prompt-feedback').textContent = t('noSessions')
    return
  }
  promptBusy = true
  document.querySelector('#prompt-feedback').textContent = t('sending')
  try {
    await window.lokki.sendPrompt({ text: message, agentId })
  } catch (error) {
    promptBusy = false
    document.querySelector('#prompt-feedback').textContent = error.message || t('noSessions')
  }
})
window.lokki.onPromptResult((result) => {
  promptBusy = false
  document.querySelector('#prompt-feedback').textContent = result.ok ? t('sent') : (result.error || t('noSessions'))
  if (result.ok) document.querySelector('#prompt-text').value = ''
})
document.querySelector('#language').addEventListener('change', (event) => setSetting('language', event.target.value))
document.querySelectorAll('.theme-option').forEach((button) => button.addEventListener('click', () => setSetting('themePreference', button.dataset.theme)))
document.querySelector('#pet-select').addEventListener('change', (event) => setSetting('petId', event.target.value))
for (const id of ['size', 'opacity']) document.querySelector('#' + id).addEventListener('input', (event) => {
  document.querySelector('#' + id + '-value').textContent = event.target.value + (id === 'opacity' ? t('percent') : ' ' + t('pixels'))
  setSetting(id, Number(event.target.value))
})
for (const [id, key] of [['always-on-top', 'alwaysOnTop'], ['reduced-motion', 'reducedMotion']]) {
  document.querySelector('#' + id).addEventListener('change', (event) => setSetting(key, event.target.checked))
}
document.querySelector('#open-library').addEventListener('click', () => void window.lokki.openLibrary())
document.querySelector('#rescan').addEventListener('click', () => void window.lokki.rescan())
document.querySelector('#pet-view').addEventListener('dblclick', () => void window.lokki.openSettings())
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

if (mode === 'pet') petView.hidden = false
else settingsView.hidden = false
