import { sessionStablePrefixSections } from './session-stable-prefix.js'

/** Public generation DTO. Revisions, checkpoints and receipts stay with the host. */
export function publicBodyMaterials(materials) {
  const context = []
  for (const section of sessionStablePrefixSections(null, materials.cardContext || '')) {
    const kind = section.name === 'tavern:user-preference' ? 'persona'
      : section.name === 'tavern:constant-worldbook' ? 'worldbook' : 'character'
    if (section.text) context.push({ id: section.name, kind, text: section.text, source: 'tavern' })
  }
  if (materials.worldbook?.context) context.push({ id: 'worldbook', kind: 'worldbook', text: materials.worldbook.context, source: 'tavern' })
  const kinds = { writingRules: 'writing-rules', guide: 'guide', scriptReference: 'script' }
  for (const [index, item] of (materials.writingRequirements || []).entries()) {
    if (item.kind !== 'guidance') context.push({ id: 'requirement:' + index, kind: kinds[item.kind] || 'other', text: item.text, source: 'tavern' })
  }
  const state = materials.generationState || materials.beforeState || {}
  return {
    schemaVersion: 1, gameId: materials.gameId, operationId: materials.target?.operationId,
    reason: materials.target?.kind === 'generate' ? 'normal' : materials.target?.kind === 'failed' ? 'retry' : 'regenerate',
    input: { raw: materials.input?.raw || '', text: materials.input?.projected || '' },
    history: structuredClone(materials.history || []), context,
    identities: { characterName: materials.card?.name || '', playerName: materials.persona?.name || '你' },
    state: { variables: structuredClone(state.variables ?? null), messageVariables: structuredClone(state.messageVariables ?? null), status: state.posture || '' },
    guidance: materials.guidance || '',
  }
}
