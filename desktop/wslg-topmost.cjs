const { spawn } = require('node:child_process')

const APPLY_MARKER = 'LOKKI_ZORDER_APPLIED'
const WINDOWS_SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$topmost = @@TOPMOST@@
$windowTitle = @@WINDOW_TITLE@@
$hideFromTaskbar = @@HIDE_FROM_TASKBAR@@
$removeFrame = @@REMOVE_FRAME@@
$source = @'
using System;
using System.Runtime.InteropServices;
public static class LokkiWindowNative {
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@
if (-not ('LokkiWindowNative' -as [type])) { Add-Type -TypeDefinition $source }
$zOrder = if ($topmost) { [IntPtr](-1) } else { [IntPtr](-2) }
$applied = $false
$titlePattern = '^' + [regex]::Escape($windowTitle) + '( \([^)]+\))?$'
Get-Process -Name msrdc -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.MainWindowTitle -match $titlePattern -and $_.MainWindowHandle -ne 0) {
        $style = [LokkiWindowNative]::GetWindowLongPtr($_.MainWindowHandle, -20).ToInt64()
        if ($hideFromTaskbar) {
            $style = ($style -band (-bnot [long]0x40000)) -bor [long]0x80
        } else {
            $style = ($style -band (-bnot [long]0x80)) -bor [long]0x40000
        }
        if ($topmost) { $style = $style -bor [long]0x8 } else { $style = $style -band (-bnot [long]0x8) }
        if ($removeFrame) {
            $windowStyle = [LokkiWindowNative]::GetWindowLongPtr($_.MainWindowHandle, -16).ToInt64()
            $windowStyle = $windowStyle -band (-bnot [long]0x40000)
            [LokkiWindowNative]::SetWindowLongPtr($_.MainWindowHandle, -16, [IntPtr]$windowStyle) | Out-Null
            $style = $style -band (-bnot [long]0x100)
            $noNonClient = 1
            $noBorder = -2
            $noCorners = 1
            [LokkiWindowNative]::DwmSetWindowAttribute($_.MainWindowHandle, 2, [ref]$noNonClient, 4) | Out-Null
            [LokkiWindowNative]::DwmSetWindowAttribute($_.MainWindowHandle, 34, [ref]$noBorder, 4) | Out-Null
            [LokkiWindowNative]::DwmSetWindowAttribute($_.MainWindowHandle, 33, [ref]$noCorners, 4) | Out-Null
        }
        [LokkiWindowNative]::SetWindowLongPtr($_.MainWindowHandle, -20, [IntPtr]$style) | Out-Null
        if ($removeFrame -and [LokkiWindowNative]::IsIconic($_.MainWindowHandle)) {
            [LokkiWindowNative]::ShowWindow($_.MainWindowHandle, 4) | Out-Null
        }
        $changed = [LokkiWindowNative]::SetWindowPos($_.MainWindowHandle, $zOrder, 0, 0, 0, 0, [uint32]0x233)
        $actual = [LokkiWindowNative]::GetWindowLongPtr($_.MainWindowHandle, -20).ToInt64()
        $hasExpectedTaskbarStyle = if ($hideFromTaskbar) { (($actual -band 0x80) -ne 0) -and (($actual -band 0x40000) -eq 0) } else { (($actual -band 0x40000) -ne 0) -and (($actual -band 0x80) -eq 0) }
        $hasRequestedZOrder = (($actual -band 0x8) -ne 0) -eq $topmost
        $hasNoFrame = if ($removeFrame) {
            $actualWindowStyle = [LokkiWindowNative]::GetWindowLongPtr($_.MainWindowHandle, -16).ToInt64()
            (($actualWindowStyle -band 0x40000) -eq 0) -and (($actual -band 0x100) -eq 0)
        } else { $true }
        if ($changed -and $hasExpectedTaskbarStyle -and $hasRequestedZOrder -and $hasNoFrame) { $applied = $true }
    }
}
if ($applied) { [Console]::Write('LOKKI_ZORDER_APPLIED') }
`

function isWslgEnvironment(env = process.env, platform = process.platform) {
  return platform === 'linux' && Boolean(env.WSL_DISTRO_NAME && env.WSL_INTEROP && env.WAYLAND_DISPLAY)
}

function buildPowerShellScript(topmost = true, windowTitle = 'DSH Pet Companion', hideFromTaskbar = true, removeFrame = true) {
  return WINDOWS_SCRIPT
    .replace('@@TOPMOST@@', topmost ? '$true' : '$false')
    .replace('@@WINDOW_TITLE@@', "'" + windowTitle.replaceAll("'", "''") + "'")
    .replace('@@HIDE_FROM_TASKBAR@@', hideFromTaskbar ? '$true' : '$false')
    .replace('@@REMOVE_FRAME@@', removeFrame ? '$true' : '$false')
}

function buildPowerShellScaleScript(windowTitle = 'DSH Pet Companion') {
  const escapedTitle = "'" + windowTitle.replaceAll("'", "''") + "'"
  return String.raw`$ErrorActionPreference = 'SilentlyContinue'
$windowTitle = @@WINDOW_TITLE@@
$titlePattern = '^' + [regex]::Escape($windowTitle) + '( \([^)]+\))?$'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class LokkiDpiNative {
    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);
}
'@
if (-not ('LokkiDpiNative' -as [type])) { Add-Type -TypeDefinition $source }
$window = Get-Process -Name msrdc -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -match $titlePattern -and $_.MainWindowHandle -ne 0
} | Select-Object -First 1
if ($window) { [Console]::Write([LokkiDpiNative]::GetDpiForWindow($window.MainWindowHandle)) }
`.replace('@@WINDOW_TITLE@@', escapedTitle)
}

function queryWslgScaleFactorOnce({ spawnProcess = spawn, windowTitle = 'DSH Pet Companion', timeoutMs = 600 } = {}) {
  return new Promise((resolve) => {
    let child
    let output = ''
    let finished = false
    let timer
    const finish = (scaleFactor) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(scaleFactor)
    }

    try {
      child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildPowerShellScaleScript(windowTitle)], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      finish(null)
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      const dpi = Number(output.trim())
      finish(code === 0 && dpi >= 72 && dpi <= 480 ? dpi / 96 : null)
    })
    timer = setTimeout(() => {
      child.kill?.()
      finish(null)
    }, timeoutMs)
    timer.unref?.()
  })
}

async function readWslgScaleFactor({
  env = process.env, platform = process.platform, spawnProcess = spawn,
  windowTitle = 'DSH Pet Companion', attempts = 5, retryDelayMs = 120, timeoutMs = 600,
} = {}) {
  if (!isWslgEnvironment(env, platform)) return 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const scaleFactor = await queryWslgScaleFactorOnce({ spawnProcess, windowTitle, timeoutMs })
    if (scaleFactor !== null) return scaleFactor
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }
  return 1
}

function createWslgTopmostBridge({ env = process.env, platform = process.platform, spawnProcess = spawn, windowTitle = 'DSH Pet Companion', hideFromTaskbar = true, removeFrame = true } = {}) {
  const enabled = isWslgEnvironment(env, platform)
  let timer
  let child
  let queuedAttempts = 0
  let queuedTopmost

  function schedule(topmost, attempts, delay) {
    clearTimeout(timer)
    timer = setTimeout(() => run(topmost, attempts), delay)
    timer.unref?.()
  }

  function run(topmost, attemptsLeft) {
    timer = undefined
    let output = ''
    let finished = false
    const finish = (success) => {
      if (finished) return
      finished = true
      child = undefined
      if (success) {
        const retries = queuedAttempts
        const nextTopmost = queuedTopmost
        queuedAttempts = 0
        queuedTopmost = undefined
        if (retries > 0 && nextTopmost !== topmost) schedule(nextTopmost, retries, 0)
        return
      }
      const retries = Math.max(attemptsLeft - 1, queuedAttempts)
      const nextTopmost = queuedAttempts > 0 ? queuedTopmost : topmost
      queuedAttempts = 0
      queuedTopmost = undefined
      if (retries > 0) schedule(nextTopmost, retries, 300)
    }

    try {
      // WSLg's Xwayland does not expose a usable ABOVE state; the Windows bridge applies native z-order and taskbar styles.
      child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildPowerShellScript(topmost, windowTitle, hideFromTaskbar, removeFrame)], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      finish(false)
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0 && output.includes(APPLY_MARKER)))
  }

  return {
    enabled,
    apply(topmost = true, { attempts = 3, delay = 0 } = {}) {
      if (!enabled) return
      if (child) {
        queuedAttempts = Math.max(queuedAttempts, attempts)
        queuedTopmost = Boolean(topmost)
        return
      }
      schedule(Boolean(topmost), attempts, delay)
    },
  }
}

module.exports = { buildPowerShellScaleScript, buildPowerShellScript, createWslgTopmostBridge, isWslgEnvironment, readWslgScaleFactor }
