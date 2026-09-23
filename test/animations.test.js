import { createRequire } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { animations, lookFrame } = require('../desktop/animations.cjs')

test('Hatch-Pet animation loops skip transparent cells while keeping every visible pose', () => {
  const expectedFrames = {
    idle: [0, 1, 2, 3, 4, 5, 6],
    runningRight: [0, 1, 2, 3, 4, 5, 6, 7],
    runningLeft: [0, 1, 2, 3, 4, 5, 6, 7],
    waving: [0, 1, 2, 3],
    jumping: [0, 1, 2, 3, 4],
    failed: [0, 1, 2, 3, 4, 5, 6, 7],
    waiting: [0, 1, 2, 3, 4, 5],
    running: [0, 1, 2, 3, 4, 5],
    review: [0, 1, 2, 3, 4, 5],
  }
  const expectedRows = { idle: 0, runningRight: 1, runningLeft: 2, waving: 3, jumping: 4, failed: 5, waiting: 6, running: 7, review: 8 }
  assert.deepEqual(Object.keys(animations), Object.keys(expectedRows))
  for (const [state, row] of Object.entries(expectedRows)) {
    assert.equal(animations[state].row, row, state + ' row')
    assert.deepEqual(animations[state].frames, expectedFrames[state], state + ' visible cells')
    assert.equal(animations[state].ms.length, animations[state].frames.length, state + ' timing count')
  }
})

test('the 16 look directions cover atlas rows 9 and 10 in order', () => {
  for (let index = 0; index < 16; index += 1) {
    assert.deepEqual(lookFrame(index), {
      row: 9 + Math.floor(index / 8),
      column: index % 8,
    })
  }
  assert.deepEqual(lookFrame(-1), { row: 10, column: 7 })
  assert.deepEqual(lookFrame(16), { row: 9, column: 0 })
})
