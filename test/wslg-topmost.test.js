import { createRequire } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const require = createRequire(import.meta.url)
const { buildPowerShellScaleScript, buildPowerShellScript, isWslgEnvironment, readWslgScaleFactor } = require('../desktop/wslg-topmost.cjs')

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
  assert.match(script, /\$windowTitle = 'DSH Pet Companion'/)
  assert.match(script, /\$titlePattern = '\^' \+ \[regex\]::Escape\(\$windowTitle\)/)
  assert.match(script, /\$_.MainWindowTitle -match \$titlePattern/)
  assert.match(script, /SetWindowPos/)
  assert.match(script, /SetWindowLongPtr/)
  assert.match(script, /-bor \[long\]0x80/)
  assert.match(script, /0x233/)
  assert.match(script, /\$removeFrame = \$true/)
  assert.match(script, /0x40000/)
  assert.match(script, /0x100/)
  assert.match(script, /DwmSetWindowAttribute/)
  assert.match(script, /\$noBorder = -2/)
  assert.match(script, /IsIconic/)
  assert.match(script, /ShowWindow/)
})

test('WSLg settings window stays in the taskbar while using native topmost state', () => {
  const script = buildPowerShellScript(true, 'DSH Pet Companion Settings', false, false)
  assert.match(script, /\$windowTitle = 'DSH Pet Companion Settings'/)
  assert.match(script, /\$hideFromTaskbar = \$false/)
  assert.match(script, /\$removeFrame = \$false/)
  assert.match(script, /\$titlePattern = '\^' \+ \[regex\]::Escape\(\$windowTitle\)/)
  assert.match(script, /\$_.MainWindowTitle -match \$titlePattern/)
  assert.match(script, /-bor \[long\]0x40000/)
  assert.match(script, /-band 0x80/)
})

test('reads the active WSLg window DPI and converts it to a pointer scale factor', async () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu-24.04', WSL_INTEROP: '/run/WSL/1_interop', WAYLAND_DISPLAY: 'wayland-0' }
  const script = buildPowerShellScaleScript()
  assert.match(script, /GetDpiForWindow/)
  assert.match(script, /-match \$titlePattern/)
  assert.equal(await readWslgScaleFactor({ env: {}, platform: 'linux' }), 1)
})

test('retries WSLg DPI lookup until its window appears', async () => {
  const env = { WSL_DISTRO_NAME: 'Ubuntu-24.04', WSL_INTEROP: '/run/WSL/1_interop', WAYLAND_DISPLAY: 'wayland-0' }
  let attempts = 0
  const spawnProcess = () => {
    attempts += 1
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    queueMicrotask(() => {
      child.stdout.end(attempts === 1 ? '' : '120')
      child.stdout.once('end', () => child.emit('close', 0))
    })
    return child
  }
  const scaleFactor = await readWslgScaleFactor({ env, platform: 'linux', spawnProcess, retryDelayMs: 0 })
  assert.equal(scaleFactor, 1.25)
  assert.equal(attempts, 2)
})
