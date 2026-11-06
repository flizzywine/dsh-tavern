// Models now and then write a variable key percent-encoded (%E5%9C%BA%E6%99%AF for 场景), as in
// the URI-fragment form of a JSON Pointer, at times twice over. These helpers turn such a key
// back into its name; a key that does not decode cleanly (100%) stays as written.

/** The key as written, then decoded once, twice: the forms it may stand for. */
export function keyForms(key) {
  const forms = [String(key)]
  for (let current = forms[0]; forms.length < 4 && /%[0-9A-Fa-f]{2}/.test(current);) {
    try { current = decodeURIComponent(current) } catch { break }
    if (forms.includes(current)) break
    forms.push(current)
  }
  return forms
}

/** The plain name of a key: fully decoded. */
export function plainKey(key) {
  return keyForms(key).at(-1)
}

/** A value with every object key given its plain name. */
export function plainKeys(value) {
  if (Array.isArray(value)) return value.map(plainKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [plainKey(key), plainKeys(child)]))
}

/** A slash path (/a/b) with every segment given its plain name. */
export function plainPath(path) {
  return String(path).split('/').map(plainKey).join('/')
}
