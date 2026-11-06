import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// DSH 0.2.1 centralizes each font role's schema, controls and validation in
// FONT_SIZE_SPECS. Raise only the text role; code and terminal keep host limits.
const textSpec = indent => `variable: "--dsh-content-font-size",\n${indent}min: 10,\n${indent}max: 22,`
const replacements = {
  'index.js': [
    ['const FONT_SIZE_MAX = 22;', 'const FONT_SIZE_MAX = 32;'],
    [textSpec('\t\t'), textSpec('\t\t').replace('max: 22,', 'max: 32,')],
  ],
  'client.js': [
    [textSpec('\t\t\t\t'), textSpec('\t\t\t\t').replace('max: 22,', 'max: 32,')],
  ],
}

export function patchThemeFontLimit(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-theme') throw new Error('字号补丁仅适用于 dsh-client-ui-theme')
  // Cosmetic and version-independent: applied wherever every anchor matches,
  // skipped (null) otherwise instead of rolling back the install. Validate every
  // anchor before writing; repeated installation is a no-op.
  const changes = []
  for (const [name, pairs] of Object.entries(replacements)) {
    const file = path.join(directory, 'lib', name)
    let before
    try { before = readFileSync(file, 'utf8') } catch { return null }
    let after = before
    for (const [from, to] of pairs) {
      if (after.split(from).length === 2 && !after.includes(to)) after = after.replace(from, to)
      else if (after.includes(from) || after.split(to).length !== 2) return null
    }
    if (after !== before) changes.push({ file, before, after })
  }
  const written = []
  try {
    for (const change of changes) {
      written.push(change)
      writeFileSync(change.file, change.after)
    }
  } catch (error) {
    for (const change of written.reverse()) writeFileSync(change.file, change.before)
    throw error
  }
  return changes.length > 0
}
