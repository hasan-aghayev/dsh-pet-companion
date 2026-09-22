import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PROMPT_CHARS, submitPrompt } from '../src/input-bridge.js'

test('submits trimmed companion text as a normal user follow-up', () => {
  let message
  submitPrompt({ status: 'idle', followup(value) { message = value } }, '  Hello Lokki  ')
  assert.match(message.id, /^[0-9a-f-]{36}$/i)
  assert.equal(message.role, 'user')
  assert.deepEqual(message.content, [{ type: 'text', text: 'Hello Lokki' }])
  assert.deepEqual(message.source, { kind: 'user' })
})

test('rejects empty, oversized, and unavailable-session messages', () => {
  const agent = { status: 'idle', followup() {} }
  assert.throws(() => submitPrompt(agent, '  '), /Type a message/)
  assert.throws(() => submitPrompt(agent, 'x'.repeat(MAX_PROMPT_CHARS + 1)), /too long/)
  assert.throws(() => submitPrompt({ status: 'disposed', followup() {} }, 'hello'), /no longer available/)
})
