// machine-local play preferences, never part of a card asset pack.
export function normalizeCardScripts(value) {
  const ids = Array.isArray(value?.muted) ? value.muted : []
  return { version: 1, muted: [...new Set(ids.filter(id => typeof id === 'string').map(id => id.trim().slice(0, 64)).filter(Boolean))].slice(0, 50) }
}

// A hint, not a parser: remote imports/dynamic code may hide audio, and comments may match.
const AUDIO_HINT = /\bnew\s+(?:(?:window|globalThis)\s*\.\s*)?Audio\b|<audio\b|\b(?:webkit)?AudioContext\b|\bcreateElement\s*\(\s*['"]audio['"]/i

export function createCardScripts({ profileData, cardIdFor }) {
  async function keyFor(cardPath) {
    const cardId = await cardIdFor(cardPath)
    if (typeof cardId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cardId)) throw new Error('Invalid cardId')
    return { key: 'card-scripts/' + cardId + '.json' }
  }
  async function read({key}) {return normalizeCardScripts(await profileData.readJson(key))}
  async function muted(cardPath) {
    return cardPath ? (await read(await keyFor(cardPath))).muted : []
  }
  return Object.freeze({
    muted,
    async version(cardPath) {
      if (!cardPath) return ''
      const keys = await keyFor(cardPath)
      await read(keys)
      return profileData.version(keys.key)
    },
    async filter(helperScripts, cardPath) {
      const excluded = new Set(await muted(cardPath))
      return (Array.isArray(helperScripts) ? helperScripts : []).filter(script => !excluded.has(String(script?.id || '').trim()))
    },
    async list(helperScripts, cardPath) {
      const excluded = new Set(await muted(cardPath))
      return { scripts: (Array.isArray(helperScripts) ? helperScripts : []).filter(script => script?.type === 'script').map(script => {
        const id = String(script.id || '').trim()
        return {
          id, name: String(script.name || '').trim() || id, type: script.type,
          enabled: script.enabled !== false, muted: excluded.has(id), audio: AUDIO_HINT.test(String(script.content || '')),
          buttonCount: Number.isSafeInteger(script.buttonCount) && script.buttonCount >= 0 ? script.buttonCount : (Array.isArray(script.buttons) ? script.buttons.length : 0)
        }
      }) }
    },
    async setMuted(cardPath, id, enabled) {
      id = typeof id === 'string' ? id.trim() : ''
      if (!id || id.length > 64) throw new Error('Invalid script ID')
      if (typeof enabled !== 'boolean') throw new Error('muted must be a boolean')
      const keys = await keyFor(cardPath)
      await read(keys)
      return normalizeCardScripts(await profileData.updateJson(keys.key, current => {
        const value = normalizeCardScripts(current)
        if (!enabled) value.muted = value.muted.filter(item => item !== id)
        else if (!value.muted.includes(id)) {
          if (value.muted.length >= 50) throw new Error('At most 50 scripts may be muted per card')
          value.muted.push(id)
        }
        return value
      }))
    }
  })
}
