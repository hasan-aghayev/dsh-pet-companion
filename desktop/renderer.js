const mode = new URLSearchParams(location.search).get('mode') || 'pet'
const petView = document.querySelector('#pet-view')
const settingsView = document.querySelector('#settings-view')
const { animations, lookFrame } = window.lokkiAnimations
let snapshot = { state: 'idle', activeAgents: 0, totalAgents: 0, settings: { language: 'en', themePreference: 'system' }, messages: {} }
let pets = []
let frameTimer
let frame = 0
let currentState = 'idle'
let currentPet
let lastPetId = ''
let animationKey = ''
let promptBusy = false
let pointerOverPet = false
let pointerInWindow = false
let lookIndex = 0
let lookUntil = 0
let lookTimer
let reactionState = ''
let reactionTimer
let ambientState = ''
let ambientTimer
let ambientEndTimer
let pointerDrag
let suppressNextPetClick = false
let dragFlushFrame
let pendingDragPointer
document.body.dataset.mode = mode

const englishFallback = {
  appTitle: 'DSH Pet Companion', settingsTitle: 'Settings', settingsDescription: 'Choose a companion and make it yours.', settingsEyebrow: 'DESKTOP COMPANION', closeSettings: 'Close settings', settingsShortcut: 'Open settings',
  pet: 'Pet', builtIn: 'built-in', animatedPetDescription: 'Animated Hatch-Pet v2 atlas.',
  portraitPetDescription: 'Still portrait with a gentle breathing effect.', size: 'Size', opacity: 'Opacity',
  language: 'Language', appearance: 'Appearance', behavior: 'Behavior', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System',
  keepOnTop: 'Keep above other windows', reducedMotion: 'Reduce motion',
  library: 'Pet library', libraryDescription: 'Add pet folders here to grow your collection.',
  openFolder: 'Open folder', refresh: 'Refresh', localFiles: 'Local files · messages stay in DSH',
  libraryPathFallback: 'DSH user folder', petCount: '{count} pets', onePet: '1 pet',
  settingsAction: 'Settings', nextPetAction: 'Next pet', pixels: 'px', percent: '%',
  typeMessage: 'Type a message', closePet: 'Close pet',
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
  document.title = t('appTitle')
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n)
  const controls = [
    ['#settings-shortcut', 'settingsShortcut'], ['#input-shortcut', 'typeMessage'], ['#close-shortcut', 'closePet'], ['#settings-close', 'closeSettings'],
  ]
  for (const [selector, key] of controls) {
    const button = document.querySelector(selector)
    button.title = t(key)
    button.setAttribute('aria-label', t(key))
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder)
}

function applyTheme() {
  const preference = snapshot.settings?.themePreference || 'system'
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || (preference === 'system' && systemDark)
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark)
  document.body.toggleAttribute('data-ds-dark-theme', dark)
}

function drawFrame() {
  if (!currentPet || currentPet.mode !== 'atlas-v2') return
  const animation = animations[currentState] || animations.idle
  const looking = currentState === 'looking'
  const direction = looking ? lookFrame(lookIndex) : null
  const column = direction ? direction.column : animation.frames[frame % animation.frames.length]
  const row = direction ? direction.row : animation.row
  const cellWidth = currentPet.width / 8
  const cellHeight = currentPet.height / 11
  const scale = Number(snapshot.settings?.size || 150) / cellWidth
  const sprite = document.querySelector('#sprite')
  sprite.style.width = (cellWidth * scale) + 'px'
  sprite.style.height = (cellHeight * scale) + 'px'
  sprite.style.backgroundImage = 'url("' + currentPet.url + '")'
  sprite.style.backgroundSize = (currentPet.width * scale) + 'px ' + (currentPet.height * scale) + 'px'
  sprite.style.backgroundPosition = (-column * cellWidth * scale) + 'px ' + (-row * cellHeight * scale) + 'px'
  sprite.style.opacity = String(Number(snapshot.settings?.opacity || 100) / 100)
}

function animate() {
  clearTimeout(frameTimer)
  if (!currentPet || currentPet.mode !== 'atlas-v2') return
  drawFrame()
  if (currentState === 'looking') return
  const animation = animations[currentState] || animations.idle
  const delay = snapshot.settings?.reducedMotion ? 1100 : animation.ms[frame % animation.ms.length]
  frame = (frame + 1) % animation.ms.length
  frameTimer = setTimeout(animate, delay)
}

function animationLength(state) {
  return (animations[state] || animations.idle).ms.reduce((total, delay) => total + delay, 0)
}

function activeAgentCount() {
  return Number(snapshot.activeAgents || 0)
}

function eventPetState() {
  const event = snapshot.petEvent
  if (!event || !animations[event.state]) return ''
  return !event.until || event.until > Date.now() ? event.state : ''
}

function desiredPetState() {
  if (reactionState) return reactionState
  const eventState = eventPetState()
  if (eventState === 'failed' || eventState === 'waiting') return eventState
  if (pointerOverPet) return 'waving'
  if (activeAgentCount() > 0) return 'running'
  if (eventState) return eventState
  if (ambientState) return ambientState
  if (lookUntil > Date.now()) return 'looking'
  return 'idle'
}

function ambientEligible() {
  return mode === 'pet'
    && currentPet?.mode === 'atlas-v2'
    && activeAgentCount() === 0
    && !pointerInWindow
    && !snapshot.settingsOpen
    && !reactionState
    && !eventPetState()
    && !snapshot.settings?.reducedMotion
    && document.querySelector('#prompt-panel').hidden
}

function scheduleAmbient() {
  if (!ambientEligible()) {
    clearTimeout(ambientTimer)
    clearTimeout(ambientEndTimer)
    ambientTimer = undefined
    ambientEndTimer = undefined
    if (!ambientState.startsWith('running')) ambientState = ''
    return
  }
  if (ambientTimer || ambientEndTimer || ambientState) return

  ambientTimer = setTimeout(() => {
    ambientTimer = undefined
    if (!ambientEligible()) return
    const canWalk = snapshot.settings?.wander !== false
    const choice = Math.random()
    if (canWalk && choice < 0.42) {
      const direction = Math.random() < 0.5 ? 'left' : 'right'
      const state = direction === 'right' ? 'runningRight' : 'runningLeft'
      ambientState = state
      renderPet()
      void window.lokki.wanderPet({
        direction,
        distance: 120 + Math.round(Math.random() * 200),
        duration: 1100 + Math.round(Math.random() * 1300),
      }).then(() => {
        if (ambientState !== state) return
        ambientState = ''
        renderPet()
      })
      return
    }
    ambientState = choice < 0.69 ? 'waiting' : 'jumping'
    renderPet()
    ambientEndTimer = setTimeout(() => {
      ambientEndTimer = undefined
      ambientState = ''
      renderPet()
    }, animationLength(ambientState))
  }, 20000 + Math.random() * 18000)
}

function playPetReaction(state = 'jumping') {
  if (mode !== 'pet' || !currentPet) return
  clearTimeout(reactionTimer)
  clearTimeout(ambientTimer)
  clearTimeout(ambientEndTimer)
  ambientTimer = undefined
  ambientEndTimer = undefined
  ambientState = ''
  reactionState = state
  void window.lokki.stopWander()
  renderPet()
  reactionTimer = setTimeout(() => {
    reactionTimer = undefined
    reactionState = ''
    renderPet()
  }, snapshot.settings?.reducedMotion ? 900 : animationLength(state))
}

function updatePointerState(isOver) {
  if (pointerOverPet === isOver) return
  pointerOverPet = isOver
  petView.dataset.petHovered = String(isOver)
  if (isOver) {
    clearTimeout(lookTimer)
    lookUntil = 0
    void window.lokki.stopWander()
  }
  renderPet()
}

function updateLookDirection(event) {
  if (pointerOverPet || activeAgentCount() > 0 || reactionState || eventPetState() || ambientState) return
  if (event.target.closest?.('.pet-toolbar, .prompt-panel')) return
  const pet = currentPet?.mode === 'atlas-v2' ? document.querySelector('#sprite') : document.querySelector('#portrait')
  if (!pet || pet.hidden) return
  const bounds = pet.getBoundingClientRect()
  const dx = event.clientX - (bounds.left + bounds.width / 2)
  const dy = event.clientY - (bounds.top + bounds.height / 2)
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
  lookIndex = Math.round(degrees / 22.5) % 16
  lookUntil = Date.now() + 900
  clearTimeout(lookTimer)
  lookTimer = setTimeout(() => {
    lookUntil = 0
    renderPet()
  }, 950)
  renderPet()
}

function schedulePointerDragFlush() {
  if (dragFlushFrame !== undefined || !pendingDragPointer) return
  dragFlushFrame = requestAnimationFrame(flushPointerDrag)
}

function flushPointerDrag() {
  if (dragFlushFrame !== undefined) {
    cancelAnimationFrame(dragFlushFrame)
    dragFlushFrame = undefined
  }
  if (!pendingDragPointer) return
  const pointer = pendingDragPointer
  pendingDragPointer = undefined
  window.lokki.movePetToPointer(pointer)
}

function handlePetDragPointerMove(event) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return
  const distance = Math.hypot(event.screenX - pointerDrag.x, event.screenY - pointerDrag.y)
  if (distance >= 6 && !pointerDrag.moved) {
    pointerDrag.moved = true
    suppressNextPetClick = true
    window.lokki.beginPetDrag({ start: { x: pointerDrag.x, y: pointerDrag.y }, current: { x: event.screenX, y: event.screenY } })
  }
  if (!pointerDrag.moved) return
  pendingDragPointer = { x: event.screenX, y: event.screenY }
  schedulePointerDragFlush()
}

function resetPetDragAfterNativeMove() {
  if (!pointerDrag) return
  const drag = pointerDrag
  if (drag.moved) suppressNextPetClick = true
  pointerDrag = undefined
  pendingDragPointer = undefined
  if (dragFlushFrame !== undefined) {
    cancelAnimationFrame(dragFlushFrame)
    dragFlushFrame = undefined
  }
  if (drag.element?.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id)
  renderPet()
}

window.lokki.onDragFinished(resetPetDragAfterNativeMove)

function finishPetDrag(event) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return
  if (pointerDrag.moved) {
    pendingDragPointer = { x: event.screenX, y: event.screenY }
    flushPointerDrag()
    window.lokki.endPetDrag({ x: event.screenX, y: event.screenY })
  }
  suppressNextPetClick = pointerDrag.moved
  pointerDrag = undefined
}

window.addEventListener('pointermove', handlePetDragPointerMove, true)
window.addEventListener('pointerup', finishPetDrag, true)
window.addEventListener('pointercancel', (event) => {
  if (!pointerDrag?.moved) finishPetDrag(event)
}, true)

function renderPet() {
  if (mode !== 'pet') return
  applyLocale()
  applyTheme()
  currentPet = pets.find((pet) => pet.id === snapshot.settings?.petId) || pets.find((pet) => pet.id === 'lokki') || pets[0]
  if (!currentPet) return
  const petName = currentPet.displayName || t('pet')
  for (const selector of ['#sprite', '#portrait']) document.querySelector(selector).setAttribute('aria-label', petName)
  if (lastPetId && lastPetId !== currentPet.id) {
    clearTimeout(reactionTimer)
    clearTimeout(ambientTimer)
    clearTimeout(ambientEndTimer)
    reactionState = ''
    ambientState = ''
    ambientTimer = undefined
    ambientEndTimer = undefined
    reactionTimer = undefined
    pointerOverPet = false
  }
  lastPetId = currentPet.id
  const nextState = desiredPetState()
  const atlas = currentPet.mode === 'atlas-v2'
  const size = Number(snapshot.settings?.size || 150)
  const petVisualHeight = atlas
    ? (currentPet.height / 11) * (size / (currentPet.width / 8))
    : size * 1.08
  const petVisualHeightValue = petVisualHeight + 'px'
  if (petView.style.getPropertyValue('--pet-visual-height') !== petVisualHeightValue) {
    petView.style.setProperty('--pet-visual-height', petVisualHeightValue)
  }
  const sprite = document.querySelector('#sprite')
  const portrait = document.querySelector('#portrait')
  const image = document.querySelector('#portrait-image')
  sprite.hidden = !atlas
  portrait.hidden = atlas
  document.querySelector('#pet-view').dataset.petState = nextState
  document.querySelector('#pet-view').dataset.lookDirection = String(lookIndex)
  if (atlas) {
    const nextKey = currentPet.id + ':' + nextState
    if (nextKey !== animationKey) {
      currentState = nextState
      animationKey = nextKey
      frame = 0
      animate()
    } else drawFrame()
  } else {
    image.src = currentPet.url
    image.style.opacity = String(Number(snapshot.settings?.opacity || 100) / 100)
    const size = Number(snapshot.settings?.size || 150)
    portrait.style.width = size + 'px'
    portrait.style.height = (size * 1.08) + 'px'
    image.style.animationPlayState = snapshot.settings?.reducedMotion ? 'paused' : 'running'
  }
  scheduleAmbient()
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
  document.querySelector('#wander').checked = settings.wander !== false
  document.querySelector('#library-path').textContent = snapshot.libraryDir || t('libraryPathFallback')
  document.querySelector('#library-path').title = snapshot.libraryDir || t('libraryPathFallback')
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
document.querySelector('#settings-close').addEventListener('click', () => void window.lokki.closeSettings())
document.querySelector('#close-shortcut').addEventListener('click', () => void window.lokki.closePet())
document.querySelector('#input-shortcut').addEventListener('click', async () => {
  const isOpen = await window.lokki.togglePrompt()
  const panel = document.querySelector('#prompt-panel')
  panel.hidden = !isOpen
  document.querySelector('#input-shortcut').setAttribute('aria-expanded', String(isOpen))
  document.querySelector('#pet-view').dataset.promptOpen = String(isOpen)
  renderPet()
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
for (const [id, key] of [['always-on-top', 'alwaysOnTop'], ['reduced-motion', 'reducedMotion'], ['wander', 'wander']]) {
  document.querySelector('#' + id).addEventListener('change', (event) => setSetting(key, event.target.checked))
}
document.querySelector('#open-library').addEventListener('click', () => void window.lokki.openLibrary())
document.querySelector('#rescan').addEventListener('click', () => void window.lokki.rescan())
const petViewElement = document.querySelector('#pet-view')
petViewElement.addEventListener('pointerenter', () => {
  pointerInWindow = true
  clearTimeout(ambientTimer)
  ambientTimer = undefined
  void window.lokki.stopWander()
})
petViewElement.addEventListener('pointerleave', () => {
  pointerInWindow = false
  renderPet()
})
petViewElement.addEventListener('pointermove', updateLookDirection)

for (const selector of ['#sprite', '#portrait']) {
  const pet = document.querySelector(selector)
  pet.addEventListener('pointerenter', () => updatePointerState(true))
  pet.addEventListener('pointerleave', () => updatePointerState(false))
  pet.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    suppressNextPetClick = false
    pointerDrag = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false, element: pet }
    pet.setPointerCapture(event.pointerId)
  })
  pet.addEventListener('click', (event) => {
    if (suppressNextPetClick) {
      suppressNextPetClick = false
      return
    }
    if (event.button !== 0 || event.detail > 1) return
    playPetReaction('jumping')
  })
  pet.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    playPetReaction('jumping')
  })
}
document.querySelector('#pet-view').addEventListener('dblclick', () => void window.lokki.openSettings())
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

if (mode === 'pet') petView.hidden = false
else settingsView.hidden = false
