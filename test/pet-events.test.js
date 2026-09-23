import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../src/index.js'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForState(file, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const state = JSON.parse(await readFile(file, 'utf8'))
      if (expected === null ? state.petEvent === null : state.petEvent?.state === expected) return state
    } catch {}
    await pause(10)
  }
  assert.fail('timed out waiting for pet event: ' + expected)
}

test('DSH error, retry, review, and human-question events select matching pet animations', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'lokki-events-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })
  const sessionsDir = path.join(home, 'pet-companion', 'sessions')
  await mkdir(sessionsDir, { recursive: true })
  const stateFile = path.join(sessionsDir, process.pid + '.json')
  const listeners = new Map()
  const agent = { id: 'test-agent', status: 'idle' }
  const ctx = {
    agents: { list: () => [agent] },
    webServer: { register: () => () => {} },
    logger: {},
    on: (name, listener) => listeners.set(name, listener),
    effect: () => {},
  }

  apply(ctx, {
    enabled: true, petId: 'lokki', size: 150, opacity: 100,
    alwaysOnTop: true, reducedMotion: false, wander: true, visible: true,
    language: 'en', themePreference: 'system',
  })

  listeners.get('agent/error')({ agent })
  assert.equal((await waitForState(stateFile, 'failed')).petEvent.state, 'failed')

  await listeners.get('agent/request-error')({ agent }, async () => 'continue')
  assert.equal((await waitForState(stateFile, 'waiting')).petEvent.state, 'waiting')

  listeners.get('agent/turn-stopping')({ agent })
  assert.equal((await waitForState(stateFile, 'review')).petEvent.state, 'review')

  let resolveQuestion
  const question = listeners.get('approval/request')({ agent }, () => new Promise((resolve) => { resolveQuestion = resolve }))
  assert.equal((await waitForState(stateFile, 'waiting')).petEvent.until, 0)
  resolveQuestion('allowed-once')
  await question
  assert.equal((await waitForState(stateFile, null)).petEvent, null)
})
