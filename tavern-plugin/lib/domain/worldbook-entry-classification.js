import { isMvuUpdateEntry } from './worldbook-recall.js'

export function hasWorldbookPreprocessingSyntax(entry = {}) {
  return /^@@/m.test(String(entry.content || '')) || /\[(?:GENERATE:|RENDER:|InitialVariables|Preprocessing)|@INJECT/.test(String(entry.content || '') + '\n' + String(entry.comment || entry.title || ''))
}

// The template engine seeds a chat's initial variables from entries naming
// [InitialVariables] in the comment or carrying the @@initial_variables operation.
// Deliberately looser than the engine's own match: a false positive costs one worker
// start on the unchanged path, a false negative would drop real initial values.
export function hasInitialVariablesEntry(entry) {
  const comment = String(entry?.comment ?? entry?.title ?? '')
  const body = String(entry?.content ?? '')
  return /@@initial_variables\b/.test(body) || /\[InitialVariables\]/i.test(comment)
}

// Optional plot entries are knowledge, not programs. Keep existing constant
// MVU delivery in place so this migration does not move it into the system prefix.
function hasRuntimeLabel(entry) {
  const name = String(entry.comment || entry.title || '')
  return /\[(?:initvar|initialvariables|mvu[_ -](?!plot\]))/i.test(name) ||
    (entry.constant === true && /\[mvu[_ -]plot\]/i.test(name))
}

/** Conservative, execution-free classification of authoritative worldbook entries.
 * Delimiters inside comments/escapes remain dynamic: host interpretation wins.
 * Only simple built-in read macros are dependency tracked. Arbitrary EJS and
 * decorators retain the native request occasion; this is not a purity proof.
 */
export function classifyWorldbookEntry(entry = {}) {
  const body = String(entry.content ?? '')
  const ejs = /<%|%>/.test(body)
  const decorators = hasWorldbookPreprocessingSyntax(entry)
  const macros = /\{\{|\}\}/.test(body)
  const program = isMvuUpdateEntry(entry) || hasRuntimeLabel(entry) || /<script\b|```\s*(?:javascript|js|typescript|ts|ejs)\b/i.test(body)
  const dynamic = ejs || decorators || macros || program
  const dependencies = []
  let nativeFallback = ejs || decorators || program
  if (macros) {
    const remainder = body.replace(/\{\{\s*(getvar|getglobalvar|hasvar|hasglobalvar)\s*::\s*([^{}:=<>!?|+]+?)\s*\}\}/gi, (_, name, key) => {
      dependencies.push({ scope: /global/i.test(name) ? 'global' : 'local', key: key.trim() })
      return ''
    }).replace(/\{\{\s*(char|user)\s*\}\}/gi, (_, name) => {
      dependencies.push({ scope: 'identity', key: name.toLowerCase() }); return ''
    })
    if (/\{\{|\}\}/.test(remainder)) nativeFallback = true
  }
  const constant = entry.constant === true
  return { kind: dynamic ? (constant ? 'dynamic-constant' : 'dynamic-conditional') : (constant ? 'static-constant' : 'static-skill'),
    dynamic, constant, dependencies, nativeFallback, occasion: nativeFallback ? 'request' : 'dependency' }
}

/** Optional static knowledge is searchable; runtime rules retain native delivery. */
export function isStaticWorldbookSkillEntry(entry = {}) {
  return entry.enabled !== false && String(entry.content || '').trim() !== '' && classifyWorldbookEntry(entry).kind === 'static-skill'
}

/** Display-only templates can be read on demand. Unknown/effectful code and
 * variable settlement rules retain the original runtime delivery path. */
export function isWorldbookRuntimeEntry(entry = {}) {
  const body = String(entry.content ?? '')
  return isMvuUpdateEntry(entry) || hasWorldbookPreprocessingSyntax(entry) ||
    hasRuntimeLabel(entry) ||
    /<script\b|```\s*(?:javascript|js|typescript|ts|ejs)\b/i.test(body) ||
    /<%(?![=-])/.test(body) ||
    /\{\{/.test(body.replace(/\{\{\s*(?:(?:getvar|getglobalvar|hasvar|hasglobalvar)\s*::[^{}]+|char|user)\s*\}\}/gi, ''))
}
