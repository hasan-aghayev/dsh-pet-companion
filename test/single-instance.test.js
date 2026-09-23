import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { acquireSingleInstanceLock } = require('../desktop/single-instance.cjs')

test('acquires the app lock before configuring profile-specific storage', () => {
  const calls = []
  const app = {
    requestSingleInstanceLock: () => { calls.push('lock'); return true },
    exit: (code) => calls.push(['exit', code]),
  }

  assert.equal(acquireSingleInstanceLock(app, () => calls.push('configure-storage')), true)
  assert.deepEqual(calls, ['lock', 'configure-storage'])
})

test('exits a duplicate Electron launch without configuring storage', () => {
  const calls = []
  const app = {
    requestSingleInstanceLock: () => { calls.push('lock'); return false },
    exit: (code) => calls.push(['exit', code]),
  }

  assert.equal(acquireSingleInstanceLock(app, () => calls.push('configure-storage')), false)
  assert.deepEqual(calls, ['lock', ['exit', 0]])
})
