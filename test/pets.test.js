import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPets } from '../src/pets.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const builtIn = path.join(root, 'assets', 'pets')

test('finds both built-in Hatch-Pet v2 atlases', async () => {
  const { pets, errors } = await discoverPets(builtIn, path.join(os.tmpdir(), 'missing-lokki-library'))
  assert.equal(errors.length, 0)
  assert.equal(pets.length, 2)

  const lokki = pets.find((pet) => pet.id === 'lokki')
  assert.ok(lokki)
  assert.equal(lokki.displayName, 'Lokki')
  assert.equal(lokki.displayNameZh, '洛奇')
  assert.equal(lokki.mode, 'atlas-v2')
  assert.equal(lokki.width, 1536)
  assert.equal(lokki.height, 2288)

  const professorLeo = pets.find((pet) => pet.id === 'professor-leo')
  assert.ok(professorLeo)
  assert.equal(professorLeo.displayName, 'Professor Leo')
  assert.equal(professorLeo.displayNameZh, '利奥教授')
  assert.equal(professorLeo.descriptionZh, '一只好奇的狮子科学家，把每个问题变成新的发现。')
  assert.equal(professorLeo.mode, 'atlas-v2')
  assert.equal(professorLeo.width, 1536)
  assert.equal(professorLeo.height, 2288)
})

test('accepts portraits and rejects image paths outside a pet folder', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'lokki-pets-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const folder = path.join(temp, 'miso')
  await mkdir(folder)
  await copyFile(path.join(builtIn, 'lokki', 'spritesheet.webp'), path.join(folder, 'portrait.webp'))
  await writeFile(path.join(folder, 'pet.json'), JSON.stringify({ id: 'miso', displayName: 'Miso', displayNameZh: '米索', description: 'A small lunar cat.', descriptionZh: '一只小小的月亮猫。', format: 'portrait', imagePath: 'portrait.webp' }))
  const result = await discoverPets(builtIn, temp)
  const portrait = result.pets.find((pet) => pet.id === 'miso' && pet.mode === 'portrait')
  assert.ok(portrait)
  assert.equal(portrait.displayNameZh, '米索')
  assert.equal(portrait.descriptionZh, '一只小小的月亮猫。')

  const bad = path.join(temp, 'escape')
  await mkdir(bad)
  await writeFile(path.join(bad, 'pet.json'), JSON.stringify({ id: 'escape', displayName: 'Escape', format: 'portrait', imagePath: '../lokki/spritesheet.webp' }))
  const withBad = await discoverPets(builtIn, temp)
  assert.ok(withBad.errors.some((message) => message.includes('escapes the pet folder')))
})
