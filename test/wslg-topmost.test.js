import { createRequire } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { buildPowerShellScript, isWslgEnvironment } = require('../desktop/wslg-topmost.cjs')

test('detects WSLg only when WSL and Wayland interop are available', () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu-24.04', WSL_INTEROP: '/run/WSL/1_interop', WAYLAND_DISPLAY: 'wayland-0' }
  assert.equal(isWslgEnvironment(env, 'linux'), true)
  assert.equal(isWslgEnvironment({ ...env, WSL_INTEROP: '' }, 'linux'), false)
  assert.equal(isWslgEnvironment(env, 'win32'), false)
})

test('PowerShell bridge can enable and disable native Windows topmost state', () => {
  const script = buildPowerShellScript(true)
  assert.match(script, /\$topmost = \$true/)
  assert.match(buildPowerShellScript(false), /\$topmost = \$false/)
  assert.match(script, /\$windowTitle = 'Lokki Companion Pet'/)
  assert.match(script, /-eq \$windowTitle/)
  assert.match(script, /SetWindowPos/)
  assert.match(script, /SetWindowLongPtr/)
  assert.match(script, /-bor \[long\]0x80/)
  assert.match(script, /0x233/)
})

test('WSLg settings window stays in the taskbar while using native topmost state', () => {
  const script = buildPowerShellScript(true, 'Lokki Companion', false)
  assert.match(script, /\$windowTitle = 'Lokki Companion'/)
  assert.match(script, /\$hideFromTaskbar = \$false/)
  assert.match(script, /-eq \$windowTitle/)
  assert.match(script, /-bor \[long\]0x40000/)
  assert.match(script, /-band 0x80/)
})
