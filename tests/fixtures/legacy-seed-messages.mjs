export function legacySeedMessages(sessionId) {
  const id = 'tavern-seed-trajectory:v1:' + sessionId + ':'
  const user = (slot, text) => ({
    id: id + slot, role: 'user', content: [{ type: 'text', text }],
    source: { kind: 'plugin:dsh-tavern', form: 'synthetic-trajectory', version: 1 }
  })
  return [
    user(1, '旧版创作说明。'),
    { id: id + '2', role: 'assistant', content: [{ type: 'text', text: '旧版开局确认。' }],
      source: { kind: 'model', provider: 'dsh-tavern', model: 'synthetic-trajectory' } },
    user(3, '旧版开场占位。')
  ]
}
