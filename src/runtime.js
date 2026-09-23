import { spawn, execFileSync } from 'node:child_process'
import { mkdir, access, chmod, rename, rm, cp, copyFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadArtifact } from '@electron/get'
import extract from 'extract-zip'
import { prepareDirectoryRoot } from './data-root.js'

export const ELECTRON_VERSION = '44.4.4'
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

function electronBinary(installRoot, platform = process.platform) {
  if (platform === 'win32') return path.join(installRoot, 'electron.exe')
  if (platform === 'darwin') return path.join(installRoot, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(installRoot, 'electron')
}

export async function ensureElectron(cacheRoot, { platform = process.platform, arch = process.arch } = {}) {
  const installRoot = path.join(cacheRoot, 'electron-' + ELECTRON_VERSION + '-' + platform + '-' + arch)
  const binary = electronBinary(installRoot, platform)
  try { await access(binary); return binary } catch {}

  await mkdir(cacheRoot, { recursive: true })
  const zip = await downloadArtifact({
    version: ELECTRON_VERSION,
    artifactName: 'electron',
    platform,
    arch,
    cacheRoot: path.join(cacheRoot, 'downloads'),
  })
  const staging = installRoot + '.extracting-' + process.pid
  await mkdir(staging, { recursive: true })
  try {
    await extract(zip, { dir: staging })
    if (platform !== 'win32') await chmod(electronBinary(staging, platform), 0o755).catch(() => {})
    await rename(staging, installRoot)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    try { await access(binary); return binary } catch {}
    throw error
  }
  await access(binary)
  return binary
}

function powershellOutput(expression) {
  return execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::Write(' + expression + ')',
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim()
}

function toWindowsPath(linuxPath) {
  return execFileSync('wslpath', ['-w', linuxPath], { encoding: 'utf8', timeout: 5000 }).trim()
}

export function canHostCompanionOnWindows(env = process.env) {
  return process.platform === 'linux' && Boolean(env.WSL_INTEROP && env.WSL_DISTRO_NAME)
}

export async function prepareWslWindowsCompanion(options) {
  const localAppData = powershellOutput("[Environment]::GetFolderPath('LocalApplicationData')")
  if (!localAppData) throw new Error('Could not locate the Windows local application data folder.')
  const linuxLocalAppData = execFileSync('wslpath', ['-u', localAppData], { encoding: 'utf8', timeout: 5000 }).trim()
  const companionRoot = path.join(linuxLocalAppData, 'dsh-pet-companion')
  const legacyRoot = path.join(linuxLocalAppData, 'dsh-lokki-companion')
  await prepareDirectoryRoot(companionRoot, legacyRoot)

  const binary = await ensureElectron(companionRoot, { platform: 'win32', arch: 'x64' })
  const stagedRoot = path.join(companionRoot, 'app')
  await mkdir(stagedRoot, { recursive: true })
  for (const entry of ['desktop', 'src', 'assets']) {
    await cp(path.join(PLUGIN_ROOT, entry), path.join(stagedRoot, entry), { recursive: true, force: true, dereference: true })
  }
  await copyFile(path.join(PLUGIN_ROOT, 'package.json'), path.join(stagedRoot, 'package.json'))
  const dependencyTarget = path.join(stagedRoot, 'node_modules', 'image-size')
  await mkdir(path.dirname(dependencyTarget), { recursive: true })
  await rm(dependencyTarget, { recursive: true, force: true })
  await cp(await realpath(path.join(PLUGIN_ROOT, 'node_modules', 'image-size')), dependencyTarget, { recursive: true, force: true, dereference: true })

  return {
    binary,
    options: {
      desktop: toWindowsPath(path.join(stagedRoot, 'desktop')),
      dshHome: toWindowsPath(options.dshHome),
      stateFile: toWindowsPath(options.stateFile),
      settingsFile: toWindowsPath(options.settingsFile),
      libraryDir: toWindowsPath(options.libraryDir),
    },
  }
}

export function desktopEntry() {
  return path.join(PLUGIN_ROOT, 'desktop')
}

export function spawnCompanion(binary, options) {
  const args = [
    options.desktop,
    '--dsh-home=' + options.dshHome,
    '--state-file=' + options.stateFile,
    '--settings-file=' + options.settingsFile,
    '--library-dir=' + options.libraryDir,
  ]
  const child = spawn(binary, args, { detached: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  child.stderr?.on('data', (chunk) => {
    const lines = String(chunk).split(/\r?\n/).filter((line) => /startup failed|Error launching app|FATAL|uncaught exception/i.test(line))
    if (lines.length) process.stderr.write('[dsh-pet-companion/electron] ' + lines.join('\n') + '\n')
  })
  return child
}

export function defaultDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}
