import { CARD_ID } from './card-storage.js'

// machine-local play preferences, never part of a card asset pack.
export function normalizeCardScripts(value) {
  const ids = Array.isArray(value?.muted) ? value.muted : []
  return { version: 1, muted: [...new Set(ids.filter(id => typeof id === 'string').map(id => id.trim().slice(0, 64)).filter(Boolean))].slice(0, 50) }
}

// A hint, not a parser: remote imports/dynamic code may hide audio, and comments may match.
const AUDIO_HINT = /\bnew\s+(?:(?:window|globalThis)\s*\.\s*)?Audio\b|<audio\b|\b(?:webkit)?AudioContext\b|\bcreateElement\s*\(\s*['"]audio['"]/i

export function createCardScripts({ profileData, cardIdFor }) {
  async function keyFor(cardPath) {
    if (!cardPath) return undefined
    const cardId = await cardIdFor(cardPath)
    if (cardId === undefined) return undefined
    if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new Error('Invalid cardId')
    return 'card-scripts/' + cardId + '.json'
  }
  async function requireKey(cardPath) {
    const key = await keyFor(cardPath)
    if (key === undefined) throw new Error('人物卡已删除或缺少身份，无法管理脚本')
    return key
  }
  async function read(key) { return normalizeCardScripts(await profileData.readJson(key)) }
  async function muted(cardPath) {
    return cardPath ? (await read(await requireKey(cardPath))).muted : []
  }
  return Object.freeze({
    muted,
    async version(cardPath) {
      const key = await keyFor(cardPath)
      if (key === undefined) return ''
      await read(key)
      return profileData.version(key)
    },
    async filter(helperScripts, cardPath) {
      const scripts = Array.isArray(helperScripts) ? helperScripts : []
      if (!cardPath) return scripts
      const key = await keyFor(cardPath)
      // A save can still display its card snapshot. Without the card ID we cannot
      // recover local mute preferences, so do not start its saved Helper scripts.
      if (key === undefined) return []
      const excluded = new Set((await read(key)).muted)
      return scripts.filter(script => !excluded.has(String(script?.id || '').trim()))
    },
    async list(helperScripts, cardPath) {
      const excluded = new Set(await muted(cardPath))
      return { scripts: (Array.isArray(helperScripts) ? helperScripts : []).filter(script => script?.type === 'script').map(script => {
        const id = String(script.id || '').trim()
        return {
          id, ref: script.ref, name: String(script.name || '').trim() || id, type: script.type,
          enabled: script.enabled !== false, muted: excluded.has(id), audio: AUDIO_HINT.test(String(script.content || '')),
          buttonCount: Number.isSafeInteger(script.buttonCount) && script.buttonCount >= 0 ? script.buttonCount : (Array.isArray(script.buttons) ? script.buttons.length : 0)
        }
      }) }
    },
    async setMuted(cardPath, id, enabled) {
      id = typeof id === 'string' ? id.trim() : ''
      if (!id || id.length > 64) throw new Error('Invalid script ID')
      if (typeof enabled !== 'boolean') throw new Error('muted must be a boolean')
      const key = await requireKey(cardPath)
      await read(key)
      return normalizeCardScripts(await profileData.updateJson(key, current => {
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
