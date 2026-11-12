import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// DSH 0.2.1 centralizes each font role's schema, controls and validation in
// FONT_SIZE_SPECS. Raise only the text role; code and terminal keep host limits.
const FONT_SIZE_MAX_FROM = 'const FONT_SIZE_MAX = 22;'
const FONT_SIZE_MAX_TO = 'const FONT_SIZE_MAX = 32;'
// The text-role spec ships readable in index.js but minified in client.js
// (0.2.2-rc.2: backtick strings, no whitespace). Match the shape rather than a
// fixed indentation, keep the host's own formatting around the change, and
// accept the already-raised value so repeated installation stays a no-op.
const TEXT_FONT_SPEC = /(variable\s*:\s*(["'`])--dsh-content-font-size\2\s*,\s*min\s*:\s*10\s*,\s*max\s*:\s*)(22|32)(\s*,)/g

function raiseTextFontMax(source) {
  const matches = [...source.matchAll(TEXT_FONT_SPEC)]
  if (matches.length !== 1) return null
  const [match] = matches
  if (match[3] === '32') return source
  return source.slice(0, match.index) + match[1] + '32' + match[4] + source.slice(match.index + match[0].length)
}

export function patchThemeFontLimit(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-theme') throw new Error('字号补丁仅适用于 dsh-client-ui-theme')
  // Cosmetic and version-independent: applied wherever every anchor matches,
  // skipped (null) otherwise instead of rolling back the install. Validate every
  // anchor before writing; repeated installation is a no-op.
  const changes = []
  for (const name of ['index.js', 'client.js']) {
    const file = path.join(directory, 'lib', name)
    let before
    try { before = readFileSync(file, 'utf8') } catch { return null }
    let after = before
    if (name === 'index.js') {
      if (after.split(FONT_SIZE_MAX_FROM).length === 2 && !after.includes(FONT_SIZE_MAX_TO)) after = after.replace(FONT_SIZE_MAX_FROM, FONT_SIZE_MAX_TO)
      else if (after.includes(FONT_SIZE_MAX_FROM) || after.split(FONT_SIZE_MAX_TO).length !== 2) return null
    }
    const raised = raiseTextFontMax(after)
    if (raised === null) return null
    after = raised
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
