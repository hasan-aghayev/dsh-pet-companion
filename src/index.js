import { mkdir, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { discoverPets } from './pets.js'
import { submitPrompt } from './input-bridge.js'
import { defaultDshHome, desktopEntry, ensureElectron, spawnCompanion } from './runtime.js'

export const name = 'lokki-companion'
export const inject = ['agents']

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  petId: Schema.string().default('lokki'),
  size: Schema.number().default(150),
  opacity: Schema.number().default(100),
  alwaysOnTop: Schema.boolean().default(true),
  reducedMotion: Schema.boolean().default(false),
  language: Schema.union(['en', 'zh']).default('en'),
  themePreference: Schema.union(['system', 'light', 'dark']).default('system'),
})

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUILT_IN_PETS = path.join(PLUGIN_ROOT, 'assets', 'pets')
const SETTINGS_KEYS = ['petId', 'size', 'opacity', 'alwaysOnTop', 'reducedMotion', 'language', 'themePreference']

function clampSettings(input, fallback) {
  const settings = { ...fallback, ...input }
  settings.petId = typeof settings.petId === 'string' ? settings.petId : fallback.petId
  settings.size = Math.max(88, Math.min(240, Number(settings.size) || fallback.size))
  settings.opacity = Math.max(35, Math.min(100, Number(settings.opacity) || fallback.opacity))
  for (const key of ['alwaysOnTop', 'reducedMotion']) settings[key] = Boolean(settings[key])
  settings.language = ['en', 'zh'].includes(settings.language) ? settings.language : fallback.language
  settings.themePreference = ['system', 'light', 'dark'].includes(settings.themePreference) ? settings.themePreference : fallback.themePreference
  return settings
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function atomicJson(file, value) {
  const temp = file + '.' + process.pid + '.tmp'
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, file)
}

export function apply(ctx, config) {
  if (!config.enabled) {
    ctx.logger?.info?.('disabled by configuration')
    return
  }

  const dshHome = path.resolve(defaultDshHome())
  const dataRoot = path.join(dshHome, 'lokki-companion')
  const userLibrary = path.join(dataRoot, 'pets')
  const cacheRoot = path.join(dshHome, 'cache', 'lokki-companion')
  const settingsFile = path.join(dataRoot, 'settings.json')
  const stateFile = path.join(dataRoot, 'sessions', process.pid + '.json')
  const fallbackSettings = clampSettings(config, config)
  const agents = new Map(ctx.agents.list().map((agent) => [agent.id, agent.status]))
  let settings = fallbackSettings
  let child
  let stopped = false
  let launching = false
  let writeChain = Promise.resolve()
  let lastState = ''
  let preferredAgentId = [...agents.keys()].at(-1) || null
  const requestDir = path.join(dataRoot, 'input-requests')
  const resultDir = path.join(dataRoot, 'input-results')

  const currentState = () => {
    const activeAgents = [...agents.values()].filter((status) => status === 'running').length
    return { state: activeAgents > 0 ? 'running' : 'idle', activeAgents, totalAgents: agents.size, agents: [...agents].map(([id, status]) => ({ id, status })), preferredAgentId, updatedAt: Date.now() }
  }

  const publish = () => {
    if (stopped) return
    const encoded = JSON.stringify({ ...currentState(), settings })
    if (encoded === lastState) return
    lastState = encoded
    writeChain = writeChain.then(() => atomicJson(stateFile, JSON.parse(encoded))).catch((error) => {
      ctx.logger?.warn?.('could not update companion state: ' + error.message)
    })
  }

  const saveSettings = async (next) => {
    settings = clampSettings(next, fallbackSettings)
    await atomicJson(settingsFile, settings)
    publish()
  }

  const syncSettings = async () => {
    const fromDisk = await readJson(settingsFile, null)
    if (fromDisk && typeof fromDisk === 'object') {
      const next = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, fromDisk[key] ?? fallbackSettings[key]]))
      settings = clampSettings(next, fallbackSettings)
      publish()
    }
  }

  const launch = async () => {
    if (stopped || launching || child) return
    launching = true
    try {
      await mkdir(userLibrary, { recursive: true })
      await mkdir(requestDir, { recursive: true, mode: 0o700 })
      await mkdir(resultDir, { recursive: true, mode: 0o700 })
      await mkdir(path.dirname(stateFile), { recursive: true })
      await mkdir(path.dirname(settingsFile), { recursive: true })
      await syncSettings()
      if (!await readJson(settingsFile, null)) await atomicJson(settingsFile, settings)
      publish()
      if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        throw new Error('No graphical display detected. In WSL2, enable WSLg and restart the DSH shell.')
      }
      const binary = await ensureElectron(cacheRoot)
      if (stopped) return
      child = spawnCompanion(binary, {
        desktop: desktopEntry(), dshHome, stateFile, settingsFile, libraryDir: userLibrary,
      })
      child.on('error', (error) => ctx.logger?.error?.('could not start companion window: ' + error.message))
      child.on('exit', (code, signal) => {
        child = undefined
        if (!stopped) ctx.logger?.warn?.('companion window closed (code=' + (code ?? 'none') + ', signal=' + (signal ?? 'none') + '); restart DSH to reopen it')
      })
      ctx.logger?.info?.('Lokki companion started; pet library: ' + userLibrary)
    } catch (error) {
      ctx.logger?.error?.('could not start Lokki companion: ' + error.message)
    } finally {
      launching = false
    }
  }

  ctx.on('agent/status', ({ agent, status }) => {
    agents.set(agent.id, status)
    if (status === 'running') preferredAgentId = agent.id
    publish()
  })
  ctx.on('agent/created', ({ agent }) => {
    agents.set(agent.id, agent.status)
    preferredAgentId = agent.id
    publish()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    agents.delete(agent.id)
    if (preferredAgentId === agent.id) preferredAgentId = [...agents.keys()].at(-1) || null
    publish()
  })

  const processPromptRequests = async () => {
    let files = []
    try { files = await readdir(requestDir) } catch { return }
    for (const file of files) {
      const match = /^([0-9a-f-]{36})\.json$/i.exec(file)
      if (!match) continue
      const requestId = match[1]
      const requestPath = path.join(requestDir, file)
      const claimedPath = path.join(requestDir, '.processing-' + requestId)
      try { await rename(requestPath, claimedPath) } catch { continue }
      let result
      try {
        const request = await readJson(claimedPath, null)
        if (!request || request.requestId !== requestId || typeof request.agentId !== 'string') throw new Error('Invalid message request.')
        const agent = ctx.agents.get(request.agentId)
        submitPrompt(agent, request.text)
        result = { requestId, ok: true }
      } catch (error) {
        result = { requestId, ok: false, error: error.message || 'Message could not be sent.' }
      }
      try { await atomicJson(path.join(resultDir, requestId + '.json'), result) } catch (error) {
        ctx.logger?.warn?.('could not save companion input result: ' + error.message)
      }
      await rm(claimedPath, { force: true }).catch(() => {})
    }
  }

  ctx.effect(() => {
    void launch()
    const settingsTimer = setInterval(() => { void syncSettings() }, 1500)
    const promptTimer = setInterval(() => { void processPromptRequests() }, 350)
    const libraryTimer = setInterval(async () => {
      const { pets, errors } = await discoverPets(BUILT_IN_PETS, userLibrary)
      if (errors.length) ctx.logger?.warn?.('pet library: ' + errors.join('; '))
      if (!pets.some((pet) => pet.id === settings.petId)) {
        const next = pets.some((pet) => pet.id === 'lokki') ? 'lokki' : pets[0]?.id
        if (next) void saveSettings({ ...settings, petId: next })
      }
    }, 5000)

    return async () => {
      stopped = true
      clearInterval(settingsTimer)
      clearInterval(promptTimer)
      clearInterval(libraryTimer)
      await writeChain.catch(() => {})
      const processToStop = child
      if (processToStop && !processToStop.killed) {
        let exited = false
        processToStop.once('exit', () => { exited = true })
        processToStop.kill('SIGTERM')
        await new Promise((resolve) => setTimeout(resolve, 1600))
        if (!exited) processToStop.kill('SIGKILL')
      }
      await rm(stateFile, { force: true }).catch(() => {})
      ctx.logger?.info?.('Lokki companion stopped')
    }
  }, 'lokki-companion desktop process')
}
