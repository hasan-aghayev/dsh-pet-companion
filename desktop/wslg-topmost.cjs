const { spawn } = require('node:child_process')

const APPLY_MARKER = 'LOKKI_ZORDER_APPLIED'
const WINDOWS_SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$topmost = @@TOPMOST@@
$windowTitle = @@WINDOW_TITLE@@
$hideFromTaskbar = @@HIDE_FROM_TASKBAR@@
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
}
'@
if (-not ('LokkiWindowNative' -as [type])) { Add-Type -TypeDefinition $source }
$zOrder = if ($topmost) { [IntPtr](-1) } else { [IntPtr](-2) }
$applied = $false
Get-Process -Name msrdc -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.MainWindowTitle -eq $windowTitle -and $_.MainWindowHandle -ne 0) {
        $style = [LokkiWindowNative]::GetWindowLongPtr($_.MainWindowHandle, -20).ToInt64()
        if ($hideFromTaskbar) {
            $style = ($style -band (-bnot [long]0x40000)) -bor [long]0x80
        } else {
            $style = ($style -band (-bnot [long]0x80)) -bor [long]0x40000
        }
        if ($topmost) { $style = $style -bor [long]0x8 } else { $style = $style -band (-bnot [long]0x8) }
        [LokkiWindowNative]::SetWindowLongPtr($_.MainWindowHandle, -20, [IntPtr]$style) | Out-Null
        $changed = [LokkiWindowNative]::SetWindowPos($_.MainWindowHandle, $zOrder, 0, 0, 0, 0, [uint32]0x233)
        $actual = [LokkiWindowNative]::GetWindowLongPtr($_.MainWindowHandle, -20).ToInt64()
        $hasExpectedTaskbarStyle = if ($hideFromTaskbar) { (($actual -band 0x80) -ne 0) -and (($actual -band 0x40000) -eq 0) } else { (($actual -band 0x40000) -ne 0) -and (($actual -band 0x80) -eq 0) }
        $hasRequestedZOrder = (($actual -band 0x8) -ne 0) -eq $topmost
        if ($changed -and $hasExpectedTaskbarStyle -and $hasRequestedZOrder) { $applied = $true }
    }
}
if ($applied) { [Console]::Write('LOKKI_ZORDER_APPLIED') }
`

function isWslgEnvironment(env = process.env, platform = process.platform) {
  return platform === 'linux' && Boolean(env.WSL_DISTRO_NAME && env.WSL_INTEROP && env.WAYLAND_DISPLAY)
}

function buildPowerShellScript(topmost = true, windowTitle = 'Lokki Companion Pet', hideFromTaskbar = true) {
  return WINDOWS_SCRIPT
    .replace('@@TOPMOST@@', topmost ? '$true' : '$false')
    .replace('@@WINDOW_TITLE@@', "'" + windowTitle.replaceAll("'", "''") + "'")
    .replace('@@HIDE_FROM_TASKBAR@@', hideFromTaskbar ? '$true' : '$false')
}

function createWslgTopmostBridge({ env = process.env, platform = process.platform, spawnProcess = spawn, windowTitle = 'Lokki Companion Pet', hideFromTaskbar = true } = {}) {
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
      child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildPowerShellScript(topmost, windowTitle, hideFromTaskbar)], {
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

module.exports = { buildPowerShellScript, createWslgTopmostBridge, isWslgEnvironment }
