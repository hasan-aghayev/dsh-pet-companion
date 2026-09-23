import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareDataRoot, prepareDirectoryRoot } from '../src/data-root.js'

test('moves the existing local library and settings to the generic companion folder', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'pet-companion-data-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const legacy = path.join(home, 'lokki-companion')
  await mkdir(path.join(legacy, 'pets', 'miso'), { recursive: true })
  await writeFile(path.join(legacy, 'settings.json'), '{"size":150}')
  await writeFile(path.join(legacy, 'pets', 'miso', 'pet.json'), '{"id":"miso"}')

  const dataRoot = await prepareDataRoot(home)
  assert.equal(dataRoot, path.join(home, 'pet-companion'))
  assert.equal(await readFile(path.join(dataRoot, 'settings.json'), 'utf8'), '{"size":150}')
  assert.equal(await readFile(path.join(dataRoot, 'pets', 'miso', 'pet.json'), 'utf8'), '{"id":"miso"}')
  await assert.rejects(readFile(path.join(legacy, 'settings.json'), 'utf8'), { code: 'ENOENT' })
})

test('keeps current files when merging a legacy library into an existing companion folder', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'pet-companion-merge-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const current = path.join(home, 'pet-companion')
  const legacy = path.join(home, 'lokki-companion')
  await mkdir(path.join(current, 'pets'), { recursive: true })
  await mkdir(path.join(legacy, 'pets', 'miso'), { recursive: true })
  await writeFile(path.join(current, 'settings.json'), '{"size":180}')
  await writeFile(path.join(legacy, 'settings.json'), '{"size":130}')
  await writeFile(path.join(legacy, 'pets', 'miso', 'pet.json'), '{"id":"miso"}')

  const dataRoot = await prepareDataRoot(home)
  assert.equal(await readFile(path.join(dataRoot, 'settings.json'), 'utf8'), '{"size":180}')
  assert.equal(await readFile(path.join(dataRoot, 'pets', 'miso', 'pet.json'), 'utf8'), '{"id":"miso"}')
})

test('migrates a legacy runtime cache directory without losing its contents', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'pet-companion-cache-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const current = path.join(home, 'cache', 'pet-companion')
  const legacy = path.join(home, 'cache', 'lokki-companion')
  await mkdir(path.join(legacy, 'electron'), { recursive: true })
  await writeFile(path.join(legacy, 'electron', 'version.txt'), 'cached')

  assert.equal(await prepareDirectoryRoot(current, legacy), current)
  assert.equal(await readFile(path.join(current, 'electron', 'version.txt'), 'utf8'), 'cached')
  await assert.rejects(readFile(path.join(legacy, 'electron', 'version.txt'), 'utf8'), { code: 'ENOENT' })
})
