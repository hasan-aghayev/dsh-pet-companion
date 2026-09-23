function buildNativeDragScript(windowTitle = 'DSH Pet Companion') {
  const escapedTitle = "'" + windowTitle.replaceAll("'", "''") + "'"
  return String.raw`$ErrorActionPreference = 'SilentlyContinue'
$windowTitle = @@WINDOW_TITLE@@
$titlePattern = '^' + [regex]::Escape($windowTitle) + '( \([^)]+\))?$'
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class LokkiDragNative {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
    public static bool LeftButtonDown() { return (GetAsyncKeyState(1) & 0x8000) != 0; }
}
'@
if (-not ('LokkiDragNative' -as [type])) { Add-Type -TypeDefinition $source }
[void][LokkiDragNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
function Write-LokkiLine([string]$value) { [Console]::WriteLine($value); [Console]::Out.Flush() }
Write-LokkiLine('LOKKI_NATIVE_DRAG_READY')
$wasDown = $false
$armed = $false
$dragging = $false
$handle = [IntPtr]::Zero
$initial = New-Object 'LokkiDragNative+RECT'
$pointerStart = New-Object 'LokkiDragNative+POINT'
$monitorInfo = New-Object 'LokkiDragNative+MONITORINFO'
while ($true) {
    $isDown = [LokkiDragNative]::LeftButtonDown()
    if ($isDown -and -not $wasDown) {
        $window = Get-Process -Name msrdc -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowTitle -match $titlePattern -and $_.MainWindowHandle -ne 0
        } | Select-Object -First 1
        $armed = $false
        $dragging = $false
        if ($window) {
            $handle = [IntPtr]$window.MainWindowHandle
            if ([LokkiDragNative]::GetWindowRect($handle, [ref]$initial) -and [LokkiDragNative]::GetCursorPos([ref]$pointerStart)) {
                $width = $initial.Right - $initial.Left
                $height = $initial.Bottom - $initial.Top
                $insidePetX = $pointerStart.X -ge ($initial.Left + [int]($width * 0.12)) -and $pointerStart.X -le ($initial.Right - [int]($width * 0.12))
                $insidePetY = $pointerStart.Y -ge ($initial.Top + [int]($height * 0.27)) -and $pointerStart.Y -le ($initial.Bottom - [int]($height * 0.02))
                $armed = $insidePetX -and $insidePetY
                if ($armed) {
                    $monitor = [LokkiDragNative]::MonitorFromWindow($handle, 2)
                    $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
                    $armed = [LokkiDragNative]::GetMonitorInfo($monitor, [ref]$monitorInfo)
                }
            }
        }
    }
    if ($isDown -and $armed) {
        $pointer = New-Object 'LokkiDragNative+POINT'
        if ([LokkiDragNative]::GetCursorPos([ref]$pointer)) {
            $deltaX = $pointer.X - $pointerStart.X
            $deltaY = $pointer.Y - $pointerStart.Y
            if (-not $dragging -and [Math]::Sqrt(($deltaX * $deltaX) + ($deltaY * $deltaY)) -ge 6) { $dragging = $true }
            if ($dragging) {
                $width = $initial.Right - $initial.Left
                $height = $initial.Bottom - $initial.Top
                $x = $initial.Left + $deltaX
                $y = $initial.Top + $deltaY
                $x = [Math]::Max($monitorInfo.rcWork.Left, [Math]::Min($monitorInfo.rcWork.Right - $width, $x))
                $y = [Math]::Max($monitorInfo.rcWork.Top, [Math]::Min($monitorInfo.rcWork.Bottom - $height, $y))
                [LokkiDragNative]::SetWindowPos($handle, [IntPtr]::Zero, $x, $y, 0, 0, [uint32]0x215) | Out-Null
            }
        }
    }
    if (-not $isDown -and $wasDown -and $dragging) {
        $final = New-Object 'LokkiDragNative+RECT'
        if ([LokkiDragNative]::GetWindowRect($handle, [ref]$final)) {
            Write-LokkiLine((@{ ok = $true; left = $final.Left; top = $final.Top; startLeft = $initial.Left; startTop = $initial.Top; scale = ([LokkiDragNative]::GetDpiForWindow($handle) / 96.0) } | ConvertTo-Json -Compress))
        }
    }
    if (-not $isDown) {
        $armed = $false
        $dragging = $false
    }
    $wasDown = $isDown
    [Threading.Thread]::Sleep(8)
}`.replace('@@WINDOW_TITLE@@', escapedTitle)
}

function isWslgEnvironment(env = process.env, platform = process.platform) {
  return platform === 'linux' && Boolean(env.WSL_DISTRO_NAME && env.WSL_INTEROP && env.WAYLAND_DISPLAY)
}

module.exports = { buildNativeDragScript, isWslgEnvironment }
