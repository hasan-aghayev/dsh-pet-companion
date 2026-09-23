import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { closePet } = require('../desktop/close-pet.cjs')

test('closing saves Show pet as off before hiding the window', async () => {
  const events = []
  let finishSave
  const closing = closePet({
    persistSettings: (settings) => {
      events.push(['save-start', settings])
      return new Promise((resolve) => { finishSave = () => { events.push('saved'); resolve() } })
    },
    hide: () => events.push('hide'),
  })

  assert.deepEqual(events, [['save-start', { visible: false }]])
  finishSave()
  await closing
  assert.deepEqual(events, [['save-start', { visible: false }], 'saved', 'hide'])
})

test('closing still hides the window if saving Show pet fails', async () => {
  const events = []
  await closePet({
    persistSettings: async (settings) => {
      events.push(['save', settings])
      throw new Error('disk full')
    },
    onError: (error) => events.push(['error', error.message]),
    hide: () => events.push('hide'),
  })

  assert.deepEqual(events, [
    ['save', { visible: false }],
    ['error', 'disk full'],
    'hide',
  ])
})
