import { randomUUID } from 'node:crypto'

export const MAX_PROMPT_CHARS = 20000

export function submitPrompt(agent, value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error('Type a message first.')
  if (text.length > MAX_PROMPT_CHARS) throw new Error('Message is too long.')
  if (!agent || !['idle', 'running'].includes(agent.status) || typeof agent.followup !== 'function') {
    throw new Error('That DSH session is no longer available.')
  }

  agent.followup({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}
