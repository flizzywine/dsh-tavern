// The mods whose director mark turns story text into their own source (stage contribution sourceMarker with a view): the
// mark command, the source view key a record binds (record.binding.mods.sourceViews[view]) and how a view is made from the
// mod's catalogue. The stage reads these instead of naming a mod (docs/mod-authoring.md).
//   sourceMarker: {op, valid, command, view, viewOf(catalogue) -> view | null, presents(args, receipt, catalogue) -> boolean}
export function createModSourceViews(contributions) {
  const sources = () => contributions().filter(row => row.sourceMarker?.view)
  const of = modId => sources().find(row => row.modId === modId)?.sourceMarker || null
  const marks = op => op?.op === 'mod.command' && of(op.modId)?.command === op.commandId
  const bound = record => {
    for (const row of sources()) {
      const view = record?.binding?.mods?.sourceViews?.[row.sourceMarker.view]
      if (view) return {modId:row.modId, view}
    }
    return null
  }
  return Object.freeze({
    sources, of, marks, bound,
    // The rounds whose director record binds a source view and marks it (records: turn -> record).
    rounds:records => [...records].flatMap(([turn, record]) => bound(record) && record.entries?.some(entry => entry.ops?.some(marks)) ? [turn] : []),
    // The views a turn's active catalogues give (modId -> catalogue), keyed by view.
    views:catalogues => Object.fromEntries(sources().filter(row => catalogues[row.modId]).map(row => [row.sourceMarker.view, row.sourceMarker.viewOf(catalogues[row.modId])])),
  })
}
