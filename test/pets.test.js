import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPets } from '../src/pets.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const builtIn = path.join(root, 'assets', 'pets')

test('finds the built-in Lokki Hatch-Pet v2 atlas', async () => {
  const { pets, errors } = await discoverPets(builtIn, path.join(os.tmpdir(), 'missing-lokki-library'))
  assert.equal(errors.length, 0)
  assert.equal(pets.length, 1)
  assert.equal(pets[0].id, 'lokki')
  assert.equal(pets[0].mode, 'atlas-v2')
  assert.equal(pets[0].width, 1536)
  assert.equal(pets[0].height, 2288)
})

test('accepts portraits and rejects image paths outside a pet folder', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'lokki-pets-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const folder = path.join(temp, 'miso')
  await mkdir(folder)
  await copyFile(path.join(builtIn, 'lokki', 'spritesheet.webp'), path.join(folder, 'portrait.webp'))
  await writeFile(path.join(folder, 'pet.json'), JSON.stringify({ id: 'miso', displayName: 'Miso', description: 'A small lunar cat.', descriptionZh: '一只小小的月亮猫。', format: 'portrait', imagePath: 'portrait.webp' }))
  const result = await discoverPets(builtIn, temp)
  const portrait = result.pets.find((pet) => pet.id === 'miso' && pet.mode === 'portrait')
  assert.ok(portrait)
  assert.equal(portrait.descriptionZh, '一只小小的月亮猫。')

  const bad = path.join(temp, 'escape')
  await mkdir(bad)
  await writeFile(path.join(bad, 'pet.json'), JSON.stringify({ id: 'escape', displayName: 'Escape', format: 'portrait', imagePath: '../lokki/spritesheet.webp' }))
  const withBad = await discoverPets(builtIn, temp)
  assert.ok(withBad.errors.some((message) => message.includes('escapes the pet folder')))
})
