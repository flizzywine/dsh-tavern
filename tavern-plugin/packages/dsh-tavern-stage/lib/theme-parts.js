// Build-time split of src/client/themes.css (build.mjs) into the parts the stage client applies (theme-sheet.cjs).
// A top-level rule belongs to a family when every one of its selectors can only match while one of the family's marks is
// on some element: a built-in theme other than the default ([data-theme="crt"]), or a pack skin's own marks
// (data-fk-skin*, data-fk-cs*; one family per first word, small ones folded into "skin"). Everything else is the base,
// applied always. Parts keep the source order, so the sheet with any set of families applied cascades exactly like the
// whole file with the unused rules removed. Comments and indentation are dropped.

const SKIN_FAMILY_MIN = 8192

function stripComments(css) {
  let out = '', i = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) throw new Error('Unclosed comment in themes.css')
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(css, i)
      out += css.slice(i, end); i = end
      continue
    }
    out += c; i++
  }
  return out.split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}

function stringEnd(text, at) {
  const quote = text[at]
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === quote) return i + 1
  }
  throw new Error('Unclosed string in themes.css')
}

// Top-level statements: style rules, at-rule blocks and at-rule statements, each with its text.
function statements(css) {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '"' || c === "'") i = stringEnd(css, i) - 1
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1 }
    else if (c === ';' && depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1 }
  }
  if (depth !== 0 || css.slice(start).trim()) throw new Error('Unbalanced themes.css')
  return out
}

// The selectors of every style rule inside a statement; null when it holds something that is not a style rule
// (keyframes, font faces, at-rule statements), which stays in the base.
function selectors(statement) {
  if (!statement.endsWith('}')) return null
  const out = []
  let prelude = '', depth = 0
  for (let i = 0; i < statement.length; i++) {
    const c = statement[i]
    if (c === '"' || c === "'") { const end = stringEnd(statement, i); prelude += statement.slice(i, end); i = end - 1 }
    else if (c === '{') {
      const head = prelude.trim()
      if (head.startsWith('@')) { if (!/^@(media|supports|container)\b/.test(head)) return null }
      else if (depth === 0 || !/^(from|to|[\d.]+%)/.test(head)) out.push(...splitList(head))
      depth++; prelude = ''
    } else if (c === '}') { depth--; prelude = '' }
    else if (c === ';') prelude = ''
    else prelude += c
  }
  return out.length ? out : null
}

function splitList(text) {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1 }
  }
  out.push(text.slice(start).trim())
  return out
}

const MARK = /^\[(data-theme|data-fk-[\w-]+)(?:="([^"]*)")?\]/

// The marks one of which must be present for the selector to match: a mark at the selector's own level, or one per
// alternative of an :is()/:where()/:has() whose every alternative has one. [] when no such set exists.
function needs(selector, defaultTheme) {
  let found = null
  const groups = []
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === '"' || c === "'") { i = stringEnd(selector, i) - 1; continue }
    if (c === '[') {
      const end = selector.indexOf(']', i)
      const mark = mark_(selector.slice(i, end + 1), defaultTheme)
      if (mark && !found) found = [mark]
      i = end
      continue
    }
    if (c === '(') {
      const end = closing(selector, i)
      const pseudo = selector.slice(0, i).match(/:([\w-]+)$/)?.[1]
      if (['is', 'where', 'has'].includes(pseudo)) groups.push(selector.slice(i + 1, end))
      i = end
    }
  }
  if (found) return found
  for (const group of groups) {
    const alternatives = splitList(group).map(item => needs(item, defaultTheme))
    if (alternatives.every(item => item.length)) return alternatives.flat()
  }
  return []
}

function closing(text, at) {
  let depth = 0
  for (let i = at; i < text.length; i++) {
    if (text[i] === '"' || text[i] === "'") i = stringEnd(text, i) - 1
    else if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  throw new Error('Unbalanced selector: ' + text)
}

function mark_(token, defaultTheme) {
  const match = token.match(MARK)
  if (!match) return null
  const [, name, value] = match
  if (name === 'data-theme') return value && value !== defaultTheme ? {family:'theme-' + value, selector:'[data-theme="' + value + '"]'} : null
  const skin = name.match(/^data-fk-skin(?:-([a-z0-9]+))?/)
  if (skin) return {family:skin[1] ? 'skin-' + skin[1] : 'skin', selector:'[' + name + ']'}
  if (name.startsWith('data-fk-cs')) return {family:'skin-cs', selector:'[' + name + ']'}
  return null
}

// A statement's family: one every selector needs, else "skin" when every selector needs some skin mark.
function family(statement, defaultTheme) {
  const list = selectors(statement)
  if (!list) return null
  const need = list.map(selector => needs(selector, defaultTheme))
  if (need.some(item => !item.length)) return null
  const families = need.map(item => new Set(item.map(mark => mark.family)))
  const shared = [...families[0]].filter(name => families.every(set => set.size === 1 && set.has(name)))
  if (shared.length) return {name:shared[0], marks:need.flat().map(mark => mark.selector)}
  if (need.flat().every(mark => mark.family.startsWith('skin'))) return {name:'skin', marks:need.flat().map(mark => mark.selector)}
  return null
}

export function splitStageThemes(source, {defaultTheme}) {
  const rows = statements(stripComments(source)).map(text => ({text, family:family(text, defaultTheme)}))
  const sizes = new Map()
  for (const row of rows) if (row.family) sizes.set(row.family.name, (sizes.get(row.family.name) || 0) + row.text.length)
  for (const row of rows) if (row.family?.name.startsWith('skin-') && sizes.get(row.family.name) < SKIN_FAMILY_MIN) row.family = {...row.family, name:'skin'}
  const parts = [], marks = {}
  for (const {text, family} of rows) {
    const name = family?.name || ''
    if (family) marks[name] = [...new Set([...(marks[name] || []), ...family.marks])]
    const last = parts.at(-1)
    if (last && last[0] === name) last[1] += '\n' + text
    else parts.push([name, text])
  }
  return {marks:Object.fromEntries(Object.entries(marks).sort().map(([name, list]) => [name, list.sort().join(',')])), parts}
}
