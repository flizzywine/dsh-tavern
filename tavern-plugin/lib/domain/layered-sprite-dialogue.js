// Read-only presentation data for the existing @bubble mood field. No new director command.
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const label = value => typeof value === 'string' ? [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 64).join('') : ''
const states = value => {
  const seen = new Set()
  return (Array.isArray(value) ? value : []).slice(0, 48).flatMap(state => {
    if (typeof state?.id !== 'string' || !ID.test(state.id) || RESERVED.has(state.id) || seen.has(state.id)) return []
    seen.add(state.id)
    return [{ id: state.id, label: label(state.label) || state.id,
      ...(label(state.emotion) ? {emotion:label(state.emotion)} : {}),
      ...(label(state.parent) ? {parent:label(state.parent)} : {}) }]
  })
}
function bindings(character) {
  return [{ model: character.portrait, outfit: label(character.outfitLabel) || '默认' },
    ...(character.outfits || []).slice(0, 12).map(item => ({ model: item.model, outfit: label(item.label) }))]
    .filter(item => typeof item.model === 'string' && ID.test(item.model))
}

export function collectSpriteDialogue(config, models = []) {
  const byId = new Map(models.map(model => [model.id, model]))
  return (config?.characters || []).slice(0, 60).flatMap(character => bindings(character).flatMap(binding => {
    const pack = byId.get(binding.model)?.spritePack
    const choices = pack?.kind === 'layered-static-sprites' ? states(pack.states) : []
    return choices.length ? [{ alias: character.alias, ...binding, states: choices }] : []
  }))
}

// A draft may carry the read-only projection, but changing/removing a binding invalidates it.
// Saving always derives a fresh catalogue from the card-owned library, never from this projection.
export function normalizeSpriteDialogue(config, value) {
  const rows = Array.isArray(value) ? value.slice(0, 60 * 13) : []
  const result = [], seen = new Set()
  for (const character of (config?.characters || []).slice(0, 60)) for (const binding of bindings(character)) {
    const row = rows.find(item => item?.alias === character.alias && item.model === binding.model && item.outfit === binding.outfit)
    const choices = states(row?.states), key = JSON.stringify([character.alias, binding.model, binding.outfit])
    if (choices.length && !seen.has(key)) {
      seen.add(key)
      result.push({ alias: character.alias, model: binding.model, outfit: label(binding.outfit), states: choices })
    }
  }
  return result
}
