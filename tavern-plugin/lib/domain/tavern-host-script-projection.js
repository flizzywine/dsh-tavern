import { parse } from 'acorn'

const hostNames = new Set(['TavernHelper', 'SillyTavern'])
function property(node) {
  return node?.computed ? (node.property?.type === 'Literal' ? node.property.value : null) : node?.property?.name
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue
    if (Array.isArray(child)) child.forEach(value => walk(value, visit))
    else if (child && typeof child === 'object') walk(child, visit)
  }
}
/** Compile only known host-object accesses; never expose the real outer Window. */
export function projectTavernHostScript(source) {
  let tree
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) }
  catch { return source }
  // Preserve accesses through names the script binds itself. A local layout
  // variable named top must not disable unrelated window.parent accesses.
  const shadowed = new Set()
  walk(tree, node => {
    const patterns = node.type === 'VariableDeclarator' ? [node.id]
      : /Function/.test(node.type || '') ? (node.params || []).concat(node.id || [])
      : node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier' ? [node.local]
      : node.type === 'CatchClause' ? [node.param] : []
    patterns.forEach(pattern => walk(pattern, value => {
      if (value.type === 'Identifier' && ['window', 'parent', 'top', 'globalThis'].includes(value.name)) shadowed.add(value.name)
    }))
  })
  if (shadowed.has('globalThis')) return source
  const edits = []
  walk(tree, node => {
    if (node.type !== 'MemberExpression') return
    // Imported modules have their own lexical environment, so the entry module's
    // scoped window binding cannot protect their host DOM accesses.
    if (['parent', 'top'].includes(property(node)) && node.object?.type === 'Identifier'
      && ['window', 'globalThis'].includes(node.object.name) && !shadowed.has(node.object.name)) {
      edits.push({ start: node.start, end: node.end,
        text: '(globalThis.__dshTavernComposerWindow || ' + node.object.name + ').' + property(node) })
    }
    if (node.object?.type === 'Identifier' && ['parent', 'top'].includes(node.object.name) && !shadowed.has(node.object.name)) {
      edits.push({ start: node.object.start, end: node.object.end,
        text: '(globalThis.__dshTavernComposerWindow || globalThis).' + node.object.name })
    }
    if (!hostNames.has(property(node))) return
    const owner = node.object
    const bare = owner?.type === 'Identifier' && ['parent', 'top'].includes(owner.name) && !shadowed.has(owner.name)
    const qualified = owner?.type === 'MemberExpression' && ['parent', 'top'].includes(property(owner)) &&
      owner.object?.type === 'Identifier' && ['window', 'globalThis'].includes(owner.object.name) && !shadowed.has(owner.object.name)
    if (bare || qualified) edits.push({ start: owner.start, end: owner.end, text: 'globalThis', helper: true })
  })
  // Direct Helper accesses retain their local RPC facade; avoid overlapping the
  // parent/top edit contained in that same expression.
  const selected = edits.filter(edit => edit.helper || !edits.some(other => other.helper && other.start <= edit.start && other.end >= edit.end))
  for (const edit of selected.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  return source
}

export function projectTavernHostHtml(html) {
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_match, opening, script, closing) => opening + projectTavernHostScript(script) + closing)
}
