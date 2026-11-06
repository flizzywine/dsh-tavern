// Tavern's sections carry card, worldbook, variable and player text verbatim. The
// host interpolates unmarked sections strictly and throws on every {{name}} it has
// not registered, so a card macro such as {{user}} would fail the whole request.
// Marking at the two assembly exits covers every Tavern section, including events
// recorded before the mark existed, without rewriting them.
export function markTavernSectionsLiteral(assembly) {
  assembly.sections = (assembly.sections || []).map(section =>
    section && typeof section.name === 'string' && section.name.startsWith('tavern:') ? { ...section, interpolate: false } : section)
  return assembly
}
