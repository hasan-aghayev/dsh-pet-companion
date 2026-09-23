import { createRequire } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { getDragPosition } = require('../desktop/drag.cjs')

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }

test('drag position follows the pointer from its original window bounds at WSLg scale', () => {
  assert.deepEqual(getDragPosition(
    { bounds: { x: 800, y: 400, width: 200, height: 240 }, pointer: { x: 1200, y: 700 } },
    { x: 1080, y: 620 },
    1.25,
    workArea,
  ), { x: 650, y: 300 })
})

test('drag position clamps the whole pet window inside the current work area', () => {
  assert.deepEqual(getDragPosition(
    { bounds: { x: 100, y: 100, width: 200, height: 240 }, pointer: { x: 0, y: 0 } },
    { x: 5000, y: 5000 },
    1.25,
    workArea,
  ), { x: 1720, y: 840 })
})

test('invalid drag coordinates are ignored', () => {
  assert.equal(getDragPosition({ bounds: {}, pointer: {} }, { x: 1, y: 1 }, 1, workArea), null)
})
