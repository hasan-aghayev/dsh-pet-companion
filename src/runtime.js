import { spawn } from 'node:child_process'
import { mkdir, access, chmod, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadArtifact } from '@electron/get'
import extract from 'extract-zip'

export const ELECTRON_VERSION = '44.4.4'
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

function electronBinary(installRoot) {
  if (process.platform === 'win32') return path.join(installRoot, 'electron.exe')
  if (process.platform === 'darwin') return path.join(installRoot, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return path.join(installRoot, 'electron')
}

export async function ensureElectron(cacheRoot) {
  const installRoot = path.join(cacheRoot, 'electron-' + ELECTRON_VERSION + '-' + process.platform + '-' + process.arch)
  const binary = electronBinary(installRoot)
  try { await access(binary); return binary } catch {}

  await mkdir(cacheRoot, { recursive: true })
  const zip = await downloadArtifact({
    version: ELECTRON_VERSION,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    cacheRoot: path.join(cacheRoot, 'downloads'),
  })
  const staging = installRoot + '.extracting-' + process.pid
  await mkdir(staging, { recursive: true })
  try {
    await extract(zip, { dir: staging })
    await chmod(electronBinary(staging), 0o755).catch(() => {})
    await rename(staging, installRoot)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    try { await access(binary); return binary } catch {}
    throw error
  }
  await access(binary)
  return binary
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
    if (lines.length) process.stderr.write('[lokki-companion/electron] ' + lines.join('\n') + '\n')
  })
  return child
}

export function defaultDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}
