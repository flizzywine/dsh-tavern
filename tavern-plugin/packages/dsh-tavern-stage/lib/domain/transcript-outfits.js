// The outfit each figure wears in a round's transcript: the director record's persistent state (baseline, then each
// accepted entry by display unit `at`), reduced to figure ref → outfit key. Spans list only where the outfits change,
// so a bubble at unit `at` reads the last span at or before it. No record: none (the card's default outfit stands).
export function transcriptOutfitSpans(record) {
  if (!record) return []
  const spans = []
  let last = null
  for (const [at, state] of [[0, record.baseline], ...record.entries.map(entry => [entry.at, entry.state])]) {
    const outfits = {}
    for (const actor of Object.values(state?.actors || {})) {
      if (actor.figure && actor.outfitKey) outfits[actor.figure.packId + '/' + actor.figure.figureId] = actor.outfitKey
    }
    const key = JSON.stringify(outfits)
    if (key === last) continue
    last = key
    spans.push({at, outfits})
  }
  return spans
}
