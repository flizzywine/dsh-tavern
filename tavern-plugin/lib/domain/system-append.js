// Prepend at assembly time so saved edits also apply to existing sessions.
export function prependSystemInstruction(assembly, text) {
  const sections = (assembly.sections || []).filter(section => section.name !== 'tavern:system-append')
  if (typeof text === 'string' && text.trim()) sections.unshift({ name: 'tavern:system-append', text: text.trim() })
  assembly.sections = sections
  return assembly
}
