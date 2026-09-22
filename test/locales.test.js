import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const readLocale = async (language) => JSON.parse(await readFile(
  fileURLToPath(new URL('../desktop/locales/' + language + '.json', import.meta.url)),
  'utf8',
))

test('English and Simplified Chinese desktop locales contain the same non-empty labels', async () => {
  const [english, chinese] = await Promise.all([readLocale('en'), readLocale('zh')])
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort())
  for (const dictionary of [english, chinese]) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', key + ' must be text')
      assert.ok(value.length > 0, key + ' must not be empty')
    }
  }
})
