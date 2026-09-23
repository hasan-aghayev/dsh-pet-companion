import { createRequire } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { buildNativeDragScript, isWslgEnvironment } = require('../desktop/native-drag.cjs')

test('native WSLg drag host stays ready and moves the host window from the original grab point', () => {
  const script = buildNativeDragScript()
  assert.match(script, /GetCursorPos/)
  assert.match(script, /GetAsyncKeyState/)
  assert.match(script, /SetWindowPos/)
  assert.match(script, /rcWork\.Right/)
  assert.match(script, /LOKKI_NATIVE_DRAG_READY/)
  assert.match(script, /insidePetX/)
  assert.match(script, /insidePetY/)
  assert.match(script, /-ge 6/)
  assert.doesNotMatch(script, /Console\]::In\.ReadLine/)
  assert.match(script, /GetDpiForWindow/)
  assert.match(script, /SetThreadDpiAwarenessContext/)
})

test('native drag safely quotes the WSLg window title for PowerShell', () => {
  const script = buildNativeDragScript("Lokki's Pet")
  assert.ok(script.includes("$windowTitle = 'Lokki''s Pet'"))
  assert.doesNotMatch(script, /Lokki's Pet/)
})

test('native drag bridge is enabled only inside WSLg', () => {
  assert.equal(isWslgEnvironment({ WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL', WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true)
  assert.equal(isWslgEnvironment({ WSL_DISTRO_NAME: 'Ubuntu', WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false)
  assert.equal(isWslgEnvironment({ WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL', WAYLAND_DISPLAY: 'wayland-0' }, 'win32'), false)
})
