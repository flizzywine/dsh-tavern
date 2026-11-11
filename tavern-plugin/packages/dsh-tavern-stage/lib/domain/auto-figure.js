import resolution from '../../../dsh-presentation-protocol/src/figure-resolution.cjs'

const {resolveFigureName, normalizeCatalogueText} = resolution

// Canonical paragraphs only. Names retain their authored spelling; the shared
// resolver owns normalization, ambiguity, explicit references and batch dedupe.
export function planAutoFigures({body, figureRows, playerIdentity}) {
  const creates = [], skipped = [], rows = figureRows.map(row => ({...row,enabled:true}))
  const candidates = []
  for (const paragraph of body.paragraphs) {
    const segment = paragraph.segment
    const skip = reason => skipped.push({paragraphId:paragraph.paragraphId,reason})
    if (paragraph.kind !== 'line' || paragraph.pending || !segment?.text?.trim()) { skip('not-committed-speaker'); continue }
    const speaker = {...segment,...(paragraph.figureId ? {figureId:paragraph.figureId,packId:paragraph.packId} : {})}
    if (playerIdentity && resolveFigureName([playerIdentity],speaker).status === 'resolved') { skip('player'); continue }
    const found = resolveFigureName(rows,speaker)
    if (found.status !== 'unknown') { skip(found.status); continue }
    const name = (speaker.name || speaker.alias || '').trim()
    if (!normalizeCatalogueText(name)) { skip('unnamed'); continue }
    const duplicate = resolveFigureName(candidates,{name})
    if (duplicate.status === 'resolved') {
      creates[duplicate.row.index].paragraphIds.push(paragraph.paragraphId)
      continue
    }
    const index = creates.length
    // A handle alongside a name is not evidence that the handle is a natural alias.
    creates.push({name,aliases:[],paragraphIds:[paragraph.paragraphId]})
    candidates.push({actorKey:'automatic-candidate-' + index,index,name,aliases:[]})
  }
  return {creates,skipped}
}
