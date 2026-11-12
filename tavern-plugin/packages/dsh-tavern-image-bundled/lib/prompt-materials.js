import { activePromptBlocks } from './prompt-structure.js'
import { characterLibraryPrompt, outfitLibraryPrompt, libraryImageDetails } from './library-prompts.js'

export function fillPromptInputs(structure, supplied = {}) {
  const values = {}
  const missing = []
  for (const input of structure?.inputs || []) {
    const value = typeof supplied?.[input.key] === 'string' ? supplied[input.key] : input.default || ''
    values[input.key] = value.trim().slice(0, 2000)
    if (input.required && !values[input.key]) missing.push(input.label || input.key)
  }
  const render = text => String(text ?? '').replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g, (match, key) =>
    Object.hasOwn(values, key) ? values[key] : match)
  return {
    values, missing, render,
    structure: structure ? { ...structure, blocks: structure.blocks.map(block => ({
      ...block, text: render(block.text),
      ...(block.kind === 'library' ? { characterId: render(block.characterId), outfitId: render(block.outfitId), state: render(block.state) } : {}),
    })) } : structure,
  }
}

export function bindPromptConfig(config, preset, structure) {
  if (!preset || !structure) return config
  if (structure.modulesResolved || structure.scenarioResolved) config = { ...config, resolvedPromptTemplate: { ...preset, structure } }
  if (!config.activePromptPreset) return { ...config, promptDefault: { ...preset, structure } }
  return { ...config, promptPresets: (config.promptPresets || []).map(item => item.id === preset.id ? { ...item, structure } : item) }
}

/** Explicit ID selections are shared by story jobs, previews and the lightweight SDK. */
export function selectPromptMaterials(structure, definitions = {}, { usage = 'story', subjects, mode = 'structured', traitMode = 'auto' } = {}) {
  const selections = Array.isArray(subjects) ? subjects : activePromptBlocks(structure, usage).filter(block => block.kind === 'library' && (block.characterId || block.outfitId))
  const selected = []
  const warnings = []
  const ids = new Set()
  for (const selection of selections.slice(0, 8)) {
    if (!selection || typeof selection !== 'object') continue
    const character = selection.characterId ? (definitions.characters || []).find(item => item.id === selection.characterId && item.enabled !== false) : null
    const outfits = [...(character?.outfits || []), ...(definitions.outfits || [])]
    const outfit = selection.outfitId ? outfits.find(item => item.id === selection.outfitId && item.enabled !== false) : null
    if ((selection.characterId && !character) || (selection.outfitId && !outfit)) {
      warnings.push('引用已不可用：' + (selection.title || selection.characterId || selection.outfitId))
      continue
    }
    if (!character && !outfit) continue
    const key = JSON.stringify([character?.id, outfit?.id])
    if (ids.has(key)) continue
    ids.add(key)
    const back = selection.angle === 'back'
    const text = [
      character && [character.name, characterLibraryPrompt(character, { mode, traitMode, back }), ...libraryImageDetails(character)].filter(Boolean).join('，'),
      outfit && [outfit.name, outfitLibraryPrompt(outfit, { mode, shared: !character?.outfits?.includes(outfit), back }), ...libraryImageDetails(outfit)].filter(Boolean).join('，'),
      back ? '背影视角' : '', String(selection.state || '').trim().slice(0, 1000),
    ].filter(Boolean).join('\n')
    const references = outfit?.characterOutfitImage ? [outfit.characterOutfitImage]
      : [character?.referenceImage, outfit?.referenceImage].filter(Boolean)
    selected.push({
      characterId: character?.id || '', outfitId: outfit?.id || '', characterName: character?.name || '', outfitName: outfit?.name || '',
      angle: back ? 'back' : 'front', state: String(selection.state || '').trim().slice(0, 1000),
      positive: text, negative: [character?.traits?.negative, outfit?.negative].filter(Boolean).join('\n'), references,
    })
  }
  return { selected, warnings, positive: selected.map(item => item.positive).join('\n\n'), negative: selected.map(item => item.negative).filter(Boolean).join('\n') }
}
