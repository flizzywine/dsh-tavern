// Core components use the same declaration protocol as installed mods.
export const CORE_MODEL_MANIFESTS = [{ id: 'dsh.scene-image', name: '场景图片', modelSlots: [
  { id: 'prompt', label: '画面提示词', purpose: '为场景图片整理画面与提示词', fallback: 'foreground' },
] }]

// Model choices are configuration, never capability or prompt-cache switches.
export function modelSlotRows(manifests, enabledIds) {
  const enabled = new Set(enabledIds)
  return manifests.filter(manifest => enabled.has(manifest.id)).flatMap(manifest =>
    (manifest.modelSlots || []).map(slot => ({ ...slot, modId: manifest.id, modName: manifest.name })))
}

export function resolveModelSlot({ slot, modId, chat = {}, settings = {}, foreground = null, defaultModel = null, scoringConfig = null }) {
  const local = chat.modModels?.[modId]?.[slot.id]
  const global = settings.modModels?.[modId]?.[slot.id]
  if (slot.kind === 'scoring') return { ...structuredClone(scoringConfig), ...structuredClone(local || global || defaultModel || {}) }
  const background = slot.fallback === 'background'
    ? chat.backgroundModelSelection || settings.defaultBackgroundModel : null
  const selection = local || global || background || foreground || settings.defaultForegroundModel || defaultModel
  if (!selection) return null
  // A slot's declared `reasoning` is its initial effort (the phone call: off); only an effort chosen
  // for this slot itself overrides it - not the foreground or background model's effort it falls back to. A stored
  // `reasoningEffort: null` is an explicit 模型默认: no effort is sent.
  const own = local || global
  const chosen = { ...structuredClone(selection), ...(slot.reasoning && !(own && Object.hasOwn(own, 'reasoningEffort')) ? { reasoningEffort: slot.reasoning } : {}) }
  if (chosen.reasoningEffort === null) delete chosen.reasoningEffort
  return chosen
}

// The slot's default effort applies only where the chosen model offers it (a model without reasoning levels rejects
// any effort); otherwise the selection resolves as if the slot declared none. `efforts(selection)` lists the offers.
export async function resolveModelSlotOffered(input, efforts) {
  const chosen = resolveModelSlot(input)
  if (!chosen || !input.slot.reasoning || chosen.reasoningEffort !== input.slot.reasoning) return chosen
  if ((await efforts(chosen))?.some(row => row.id === input.slot.reasoning)) return chosen
  return resolveModelSlot({ ...input, slot: { ...input.slot, reasoning: undefined } })
}

// The caller backs up once and persists through the existing settings owners.
// Existing slot values (including an explicit null) always win over legacy data.
export function migrateModelSlots(settings, legacySelections) {
  const next = structuredClone(settings)
  next.modModels ||= {}
  for (const { modId, slotId, selection } of legacySelections) {
    if (!selection || typeof selection !== 'object') continue
    next.modModels[modId] ||= {}
    if (!Object.hasOwn(next.modModels[modId], slotId)) next.modModels[modId][slotId] = structuredClone(selection)
  }
  return next
}
