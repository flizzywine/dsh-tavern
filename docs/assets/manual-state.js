// Pure navigation/search rules shared by the browser and Node contract tests.
;(function (root) {
  const aliases = { main: 'compatibility', features: 'index', start: 'play', create: 'cards', experience: 'play', illustrate: 'advanced', script: 'c01' }
  function resolveRoute(hash, ids) {
    let target
    try { target = decodeURIComponent(hash.replace(/^#/, '')) } catch { return { id: 'not-found', target: '' } }
    if (!target) target = 'compatibility'
    if (aliases[target]) target = aliases[target]
    const id = target.split('--')[0]
    return { id: ids.includes(id) ? id : 'not-found', target }
  }
  function searchPages(pages, query) {
    const value = query.trim().toLowerCase(), words = value.split(/\s+/).filter(Boolean)
    if (!value) return pages.slice(0, 5)
    return pages.filter(p => words.every(word => p.text.toLowerCase().includes(word))).sort((a, b) => Number(b.title.toLowerCase().includes(value)) - Number(a.title.toLowerCase().includes(value)))
  }
  root.DshManualState = { resolveRoute, searchPages }
})(globalThis)
