const localOutfitId = (characterId, outfitId) => JSON.stringify([characterId, outfitId])
const outfit = (item, characterId = null) => {
  // Shared outfits have a front/back schema; character-owned outfits already use six parts.
  const parts = characterId === null ? { ...item, upper: item.body || item.upper, back: item.fullBack || item.bodyBack || item.back } : item
  return {
    id: localOutfitId(characterId, item.id), name: item.name, characterId,
    parts: Object.fromEntries(['upper', 'lower', 'shoes', 'accessory', 'full', 'back'].map(key => [key, String(parts[key] || '')])),
    negative: item.negative || '', isDefault: item.default === true,
  }
}

/** Read the live in-memory definitions, never the plugin's private JSON from another plugin. */
export function imageLibraryProvider(getDefinitions, records) {
  const characters = (definitions, context) => (definitions.characters || []).filter(item => item.enabled !== false &&
    (!item.cards?.length || Boolean(context.card && item.cards.includes(context.card))))
  const shared = definitions => (definitions.outfits || []).filter(item => item.enabled !== false)
  return {
    id: 'definitions', label: '配图人物与服装',
    ...records,
    characters(context = {}) {
      const definitions = getDefinitions(), sharedIds = new Set(shared(definitions).map(item => item.id))
      return characters(definitions, context).map(item => ({
        id: item.id, name: item.name, aliases: String(item.match || '').split(/[,，\n]/).map(s => s.trim()).filter(Boolean),
        description: item.note || '', group: item.group || '', traits: { ...item.traits },
        outfitIds: (item.outfits || []).filter(o => o.enabled !== false).map(o => localOutfitId(item.id, o.id))
          .concat((item.outfitRefs || []).filter(id => sharedIds.has(id)).map(id => localOutfitId(null, id))),
      }))
    },
    outfits(context = {}) {
      const definitions = getDefinitions(), people = characters(definitions, context).filter(item => !context.characterId || item.id === context.characterId)
      const refs = new Set(people.flatMap(item => item.outfitRefs || []))
      return people.flatMap(item => (item.outfits || []).filter(o => o.enabled !== false).map(o => outfit(o, item.id)))
        .concat(shared(definitions).filter(item => !context.characterId || refs.has(item.id)).map(item => outfit(item)))
    },
  }
}

export { imageLibraryProvider as createImageLibrary }
