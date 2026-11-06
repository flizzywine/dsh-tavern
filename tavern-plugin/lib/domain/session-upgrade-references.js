// Durable coordinate map carried by the upgraded Session, so journal revisions
// and old undo points need not be rewritten (or committed in a second store).
export const SESSION_UPGRADE_EVENT = 'dsh-tavern/session-upgrade-v1'

export function upgradeReferences(events) {
  const marker = events.findLast(event => event.type === SESSION_UPGRADE_EVENT && event.data?.version === 1)
  const sequences = new Map(marker?.data.seqMap || [])
  const turns = new Map(marker?.data.storyTurns || [])
  return {
    sequence(seq, formatVersion) { return formatVersion >= 4 ? seq : sequences.get(seq) ?? seq },
    count(count, formatVersion) {
      if (!marker || formatVersion >= 4) return count
      return count === marker.data.sourceEventCount ? marker.seq : sequences.get(count) ?? count
    },
    turn(event) { return turns.get(event?.seq) ?? Number(event?.data?.turn) },
  }
}

/** A migrated administrative edit still belongs to its original story round. */
export function storyEventTurn(event) {
  const original = event?.type === 'assistant/message' ? event.data?.message?.source?.tavernStoryTurn : undefined
  return Number.isSafeInteger(original) ? original : Number(event?.data?.turn)
}

export function upgradedAnchor(anchor, references) {
  if (!anchor || anchor.formatVersion >= 4) return anchor
  return { ...anchor, input: references.sequence(anchor.input, anchor.formatVersion), reply: references.sequence(anchor.reply, anchor.formatVersion), formatVersion: 4 }
}
