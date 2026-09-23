import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const json = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'))

test('product-facing names are generic while Lokki remains a pet entry', async () => {
  const [english, chinese, englishCard, chineseCard, manifest, readme, packageJson, cordis, client] = await Promise.all([
    json('desktop/locales/en.json'),
    json('desktop/locales/zh.json'),
    json('locale/en.json'),
    json('locale/zh.json'),
    json('assets/pets/lokki/pet.json'),
    readFile(path.join(root, 'README.md'), 'utf8'),
    json('package.json'),
    readFile(path.join(root, 'cordis.patch.yml'), 'utf8'),
    readFile(path.join(root, 'client.js'), 'utf8'),
  ])

  for (const dictionary of [english, chinese, englishCard.meta, chineseCard.meta]) {
    assert.doesNotMatch(JSON.stringify(dictionary), /lokki/i)
  }
  assert.equal(english.appTitle, 'DSH Pet Companion')
  assert.equal(chinese.appTitle, 'DSH 桌面宠物伙伴')
  assert.equal(english.closePet, 'Close pet')
  assert.equal(chinese.closePet, '关闭宠物')
  assert.equal(manifest.displayName, 'Lokki')
  assert.match(readme, /Lokki is the first built-in pet/)
  assert.equal(packageJson.icon, './assets/companion-mark.svg')
  assert.equal(packageJson.name, 'dsh-pet-companion')
  assert.match(readme, /github:hasan-aghayev\/dsh-pet-companion/)
  assert.match(cordis, /id: pet-companion/)
  assert.match(cordis, /name: dsh-pet-companion/)
  assert.match(client, /id: 'dsh-pet-companion'/)
  assert.match(client, /api\/pet-companion\/visibility/)
})
