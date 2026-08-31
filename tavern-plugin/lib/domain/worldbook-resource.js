function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function numberOr(value, fallback) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function extensionValue(entry, names, fallback) {
  const extensions = object(entry && entry.extensions) || {}
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(extensions, name)) return extensions[name]
  }
  return fallback
}

function hasOwn(value, name) {
  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, name)
}

function identifyDocument(document) {
  const raw = object(document)
  if (raw === null) throw new Error('世界书必须是 JSON 对象')
  if (object(raw.data) && object(raw.data.character_book)) return { format: 'card-embedded', book: raw.data.character_book }
  if (object(raw.character_book)) return { format: 'card-embedded', book: raw.character_book }
  if (Array.isArray(raw.entries)) return { format: 'character-book', book: raw }
  if (object(raw.entries)) return { format: 'sillytavern-worldbook', book: raw }
  throw new Error('无法识别世界书：需要 entries 对象、character_book，或 entries 数组')
}

function entryProjection(entry, sourceRef, format, index) {
  const embedded = format !== 'sillytavern-worldbook'
  const extensions = object(entry.extensions) || {}
  const primaryKeys = array(embedded ? entry.keys : entry.key).map(str)
  const secondaryKeys = array(embedded ? entry.secondary_keys : entry.keysecondary).map(str)
  const enabled = embedded ? entry.enabled !== false : entry.disable !== true
  const order = numberOr(embedded ? entry.insertion_order : entry.order, 100)
  const displayIndex = numberOr(embedded ? extensionValue(entry, ['display_index', 'displayIndex'], index) : entry.displayIndex, index)
  return {
    ref: sourceRef,
    sourceUid: embedded ? (entry.id ?? index) : (entry.uid ?? sourceRef.replace(/^entry:/, '')),
    sourcePath: embedded ? 'entries/' + index : 'entries/' + sourceRef.replace(/^entry:/, ''),
    title: str(entry.comment || entry.name).trim() || (primaryKeys[0] || '世界书条目 ' + (index + 1)),
    comment: str(entry.comment || entry.name),
    content: str(entry.content),
    enabled,
    primaryKeys,
    secondaryKeys,
    constant: entry.constant === true,
    selective: entry.selective === true,
    selectiveLogic: numberOr(embedded ? extensionValue(entry, ['selective_logic', 'selectiveLogic'], 0) : entry.selectiveLogic, 0),
    vectorized: embedded ? extensionValue(entry, ['vectorized'], false) === true : entry.vectorized === true,
    order,
    displayIndex,
    position: embedded ? str(extensionValue(entry, ['position'], entry.position || 'after_char')) : numberOr(entry.position, 0),
    depth: numberOr(embedded ? extensionValue(entry, ['depth'], 4) : entry.depth, 4),
    role: numberOr(embedded ? extensionValue(entry, ['role'], 0) : entry.role, 0),
    probabilityEnabled: embedded ? extensionValue(entry, ['use_probability', 'useProbability'], true) !== false : entry.useProbability !== false,
    probability: numberOr(embedded ? extensionValue(entry, ['probability'], 100) : entry.probability, 100),
    scanDepth: embedded ? extensionValue(entry, ['scan_depth'], null) : (entry.scanDepth ?? null),
    caseSensitive: embedded ? booleanOrNull(entry.case_sensitive ?? extensionValue(entry, ['case_sensitive'], null)) : booleanOrNull(entry.caseSensitive),
    matchWholeWords: embedded ? booleanOrNull(extensionValue(entry, ['match_whole_words'], null)) : booleanOrNull(entry.matchWholeWords),
    excludeRecursion: embedded ? extensionValue(entry, ['exclude_recursion'], false) === true : entry.excludeRecursion === true,
    preventRecursion: embedded ? extensionValue(entry, ['prevent_recursion'], false) === true : entry.preventRecursion === true,
    delayUntilRecursion: embedded ? extensionValue(entry, ['delay_until_recursion'], 0) : (entry.delayUntilRecursion ?? 0),
    group: str(embedded ? extensionValue(entry, ['group'], '') : entry.group),
    sticky: embedded ? extensionValue(entry, ['sticky'], null) : (entry.sticky ?? null),
    cooldown: embedded ? extensionValue(entry, ['cooldown'], null) : (entry.cooldown ?? null),
    delay: embedded ? extensionValue(entry, ['delay'], null) : (entry.delay ?? null),
    rawEntry: clone(entry),
  }
}

function diagnosticsOf(book, format, entries) {
  const diagnostics = []
  const refs = new Set()
  for (const entry of entries) {
    if (refs.has(entry.ref)) diagnostics.push({ level: 'warning', message: '条目编号重复：' + entry.ref })
    refs.add(entry.ref)
    for (const key of entry.primaryKeys) {
      if (!key.startsWith('/')) continue
      const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(key)
      if (!match) { diagnostics.push({ level: 'warning', ref: entry.ref, message: '正则触发词格式无法识别：' + key }); continue }
      try { new RegExp(match[1], match[2]) } catch { diagnostics.push({ level: 'warning', ref: entry.ref, message: '正则触发词无效：' + key }) }
    }
  }
  if (format === 'sillytavern-worldbook' && Array.isArray(book.entries)) diagnostics.push({ level: 'error', message: '独立世界书 entries 应为对象' })
  return diagnostics
}

export function inspectWorldBookDocument(document, options = {}) {
  const identified = identifyDocument(document)
  const book = identified.book
  const records = identified.format === 'sillytavern-worldbook'
    ? Object.entries(book.entries).map(function ([key, entry], index) { return { ref: 'entry:' + key, entry: object(entry) || {}, index } })
    : array(book.entries).map(function (entry, index) { return { ref: 'entry:' + index, entry: object(entry) || {}, index } })
  const entries = records.map(function (record) { return entryProjection(record.entry, record.ref, identified.format, record.index) })
  const fallbackName = str(options.filename).replace(/\.[^.]+$/, '')
  return {
    format: identified.format,
    displayName: str(book.name).trim() || fallbackName || '未命名世界书',
    description: str(book.description),
    entryCount: entries.length,
    enabledCount: entries.filter(function (entry) { return entry.enabled }).length,
    entries,
    diagnostics: diagnosticsOf(book, identified.format, entries),
    raw: clone(book),
  }
}

function standaloneEntryFromEmbedded(value, index) {
  const entry = object(value) || {}
  const extensions = object(entry.extensions) || {}
  const uid = numberOr(entry.id, index)
  const position = extensionValue(entry, ['position'], entry.position === 'after_char' ? 1 : 0)
  const exported = Object.assign({}, clone(entry), {
    uid,
    key: array(entry.keys).map(str),
    keysecondary: array(entry.secondary_keys).map(str),
    comment: str(entry.comment || entry.name),
    content: str(entry.content),
    constant: entry.constant === true,
    selective: entry.selective === true,
    order: numberOr(entry.insertion_order, 100),
    position: numberOr(position, entry.position === 'after_char' ? 1 : 0),
    disable: entry.enabled === false,
    extensions: clone(extensions)
  })
  delete exported.id
  delete exported.keys
  delete exported.secondary_keys
  delete exported.enabled
  delete exported.insertion_order
  delete exported.case_sensitive

  const optional = [
    ['displayIndex', ['display_index', 'displayIndex']],
    ['selectiveLogic', ['selective_logic', 'selectiveLogic']],
    ['vectorized', ['vectorized']],
    ['depth', ['depth']],
    ['role', ['role']],
    ['useProbability', ['use_probability', 'useProbability']],
    ['probability', ['probability']],
    ['scanDepth', ['scan_depth']],
    ['matchWholeWords', ['match_whole_words']],
    ['excludeRecursion', ['exclude_recursion']],
    ['preventRecursion', ['prevent_recursion']],
    ['delayUntilRecursion', ['delay_until_recursion']],
    ['group', ['group']],
    ['sticky', ['sticky']],
    ['cooldown', ['cooldown']],
    ['delay', ['delay']]
  ]
  for (const [target, names] of optional) {
    const name = names.find(function (candidate) { return hasOwn(extensions, candidate) })
    if (name !== undefined) exported[target] = clone(extensions[name])
  }
  if (hasOwn(entry, 'case_sensitive')) exported.caseSensitive = booleanOrNull(entry.case_sensitive)
  else if (hasOwn(extensions, 'case_sensitive')) exported.caseSensitive = extensions.case_sensitive === true
  return exported
}

/** Convert any supported source into SillyTavern's standalone World Info shape. */
export function exportSillyTavernWorldBook(document) {
  const identified = identifyDocument(document)
  if (identified.format === 'sillytavern-worldbook') return clone(identified.book)
  const book = identified.book
  const exported = clone(book)
  exported.originalData = clone(book)
  exported.entries = {}
  array(book.entries).forEach(function (entry, index) {
    const converted = standaloneEntryFromEmbedded(entry, index)
    exported.entries[String(converted.uid)] = converted
  })
  return exported
}

function embeddedEntryFromStandalone(value, index, original, replace = false) {
  const entry = object(value) || {}
  const previous = object(original) || {}
  const extensions = Object.assign({}, replace ? {} : object(previous.extensions) || {}, object(entry.extensions) || {})
  const uid = numberOr(entry.uid, index)
  const position = numberOr(entry.position, 0)
  const exported = Object.assign({}, clone(replace ? entry : previous), {
    id: uid,
    keys: array(entry.key).map(str),
    secondary_keys: array(entry.keysecondary).map(str),
    comment: str(entry.comment || entry.name),
    content: str(entry.content),
    constant: entry.constant === true,
    selective: entry.selective === true,
    insertion_order: numberOr(entry.order, 100),
    enabled: entry.disable !== true,
    position: position === 1 ? 'after_char' : 'before_char',
    case_sensitive: entry.caseSensitive === true,
    extensions
  })
  const optional = [
    ['displayIndex', 'display_index'],
    ['selectiveLogic', 'selective_logic'],
    ['vectorized', 'vectorized'],
    ['depth', 'depth'],
    ['role', 'role'],
    ['useProbability', 'use_probability'],
    ['probability', 'probability'],
    ['scanDepth', 'scan_depth'],
    ['matchWholeWords', 'match_whole_words'],
    ['excludeRecursion', 'exclude_recursion'],
    ['preventRecursion', 'prevent_recursion'],
    ['delayUntilRecursion', 'delay_until_recursion'],
    ['group', 'group'],
    ['sticky', 'sticky'],
    ['cooldown', 'cooldown'],
    ['delay', 'delay']
  ]
  extensions.position = position
  for (const [source, target] of optional) {
    if (replace) { delete exported[source]; delete extensions[source]; delete extensions[target] }
    if (hasOwn(entry, source)) extensions[target] = clone(entry[source])
  }
  if (replace) {
    for (const key of ['uid', 'key', 'keysecondary', 'order', 'disable', 'caseSensitive']) delete exported[key]
    delete extensions.case_sensitive
    if (hasOwn(entry, 'caseSensitive')) exported.case_sensitive = booleanOrNull(entry.caseSensitive)
    else delete exported.case_sensitive
  }
  return exported
}

/** Convert any supported source into a Character Card character_book. */
export function exportCharacterBook(document, options = {}) {
  const identified = identifyDocument(document)
  if (identified.format !== 'sillytavern-worldbook') return clone(identified.book)
  const book = identified.book
  const original = options.replace ? {} : object(book.originalData) || {}
  const exported = clone(options.replace ? book : original)
  if (options.replace) delete exported.originalData
  if (hasOwn(book, 'name')) exported.name = str(book.name)
  if (hasOwn(book, 'description')) exported.description = str(book.description)
  exported.extensions = Object.assign({}, object(original.extensions) || {}, object(book.extensions) || {})
  const originals = new Map(array(original.entries).map(function (entry, index) {
    return [numberOr(entry && entry.id, index), entry]
  }))
  exported.entries = Object.values(book.entries).map(function (entry, index) {
    const uid = numberOr(entry && entry.uid, index)
    return embeddedEntryFromStandalone(entry, index, originals.get(uid), options.replace === true)
  })
  return exported
}

function nextId(entries, field) {
  return entries.reduce(function (maximum, entry) { return Math.max(maximum, numberOr(entry && entry[field], -1)) }, -1) + 1
}

function assignKnownPatch(entry, patch, format) {
  const embedded = format !== 'sillytavern-worldbook'
  const extensions = Object.assign({}, object(entry.extensions) || {})
  function has(name) { return Object.prototype.hasOwnProperty.call(patch, name) }
  if (has('comment')) entry.comment = str(patch.comment)
  if (has('content')) entry.content = str(patch.content)
  if (has('enabled')) { if (embedded) entry.enabled = patch.enabled === true; else entry.disable = patch.enabled !== true }
  if (has('primaryKeys')) entry[embedded ? 'keys' : 'key'] = array(patch.primaryKeys).map(str)
  if (has('secondaryKeys')) entry[embedded ? 'secondary_keys' : 'keysecondary'] = array(patch.secondaryKeys).map(str)
  if (has('constant')) entry.constant = patch.constant === true
  if (has('selective')) entry.selective = patch.selective === true
  if (has('order')) entry[embedded ? 'insertion_order' : 'order'] = numberOr(patch.order, 100)
  if (has('caseSensitive')) { if (embedded) entry.case_sensitive = booleanOrNull(patch.caseSensitive); else entry.caseSensitive = booleanOrNull(patch.caseSensitive) }
  if (has('displayIndex')) { if (embedded) extensions.display_index = numberOr(patch.displayIndex, 0); else entry.displayIndex = numberOr(patch.displayIndex, 0) }
  if (has('selectiveLogic')) { if (embedded) extensions.selective_logic = numberOr(patch.selectiveLogic, 0); else entry.selectiveLogic = numberOr(patch.selectiveLogic, 0) }
  if (has('vectorized')) { if (embedded) extensions.vectorized = patch.vectorized === true; else entry.vectorized = patch.vectorized === true }
  if (has('position')) { if (embedded) extensions.position = patch.position; else entry.position = numberOr(patch.position, 0) }
  if (has('depth')) { if (embedded) extensions.depth = numberOr(patch.depth, 4); else entry.depth = numberOr(patch.depth, 4) }
  if (has('role')) { if (embedded) extensions.role = numberOr(patch.role, 0); else entry.role = numberOr(patch.role, 0) }
  if (has('probabilityEnabled')) { if (embedded) extensions.use_probability = patch.probabilityEnabled === true; else entry.useProbability = patch.probabilityEnabled === true }
  if (has('probability')) { if (embedded) extensions.probability = numberOr(patch.probability, 100); else entry.probability = numberOr(patch.probability, 100) }
  if (has('scanDepth')) { if (embedded) extensions.scan_depth = patch.scanDepth; else entry.scanDepth = patch.scanDepth }
  if (has('matchWholeWords')) { if (embedded) extensions.match_whole_words = booleanOrNull(patch.matchWholeWords); else entry.matchWholeWords = booleanOrNull(patch.matchWholeWords) }
  if (has('excludeRecursion')) { if (embedded) extensions.exclude_recursion = patch.excludeRecursion === true; else entry.excludeRecursion = patch.excludeRecursion === true }
  if (has('preventRecursion')) { if (embedded) extensions.prevent_recursion = patch.preventRecursion === true; else entry.preventRecursion = patch.preventRecursion === true }
  if (has('group')) { if (embedded) extensions.group = str(patch.group); else entry.group = str(patch.group) }
  for (const [field, embeddedField] of [['delayUntilRecursion', 'delay_until_recursion'], ['sticky', 'sticky'], ['cooldown', 'cooldown'], ['delay', 'delay']]) {
    if (has(field)) { if (embedded) extensions[embeddedField] = patch[field]; else entry[field] = patch[field] }
  }
  if (has('helperExtra')) extensions.dsh_tavern_helper_extra = clone(object(patch.helperExtra) || {})

  if (embedded || has('helperExtra')) entry.extensions = extensions
  return entry
}

export function updateWorldBookDocument(document, request = {}) {
  const source = clone(document)
  const identified = identifyDocument(source)
  const book = identified.book
  if (Object.prototype.hasOwnProperty.call(request, 'name')) book.name = str(request.name)
  if (Object.prototype.hasOwnProperty.call(request, 'description')) book.description = str(request.description)
  let operations = Array.isArray(request.operations) ? request.operations : (request.operations ? [request.operations] : [])
  if (identified.format !== 'sillytavern-worldbook') {
    const priority = { update: 0, delete: 1, add: 2 }
    operations = operations.slice().sort(function (left, right) {
      const order = (priority[str(left && left.op)] ?? 9) - (priority[str(right && right.op)] ?? 9)
      if (order !== 0) return order
      if (str(left && left.op) !== 'delete') return 0
      return Number(str(right && right.ref).replace(/^entry:/, '')) - Number(str(left && left.ref).replace(/^entry:/, ''))
    })
  }
  for (const operation of operations) {
    if (!object(operation)) throw new Error('世界书修改必须是对象')
    const op = str(operation.op)
    if (identified.format === 'sillytavern-worldbook') {
      if (op === 'add') {
        const values = Object.values(book.entries).filter(object)
        const uid = operation.uid === undefined ? nextId(values, 'uid') : operation.uid
        if (!Number.isSafeInteger(uid) || uid < 0 || Object.hasOwn(book.entries, String(uid)) || values.some(entry => Number(entry.uid) === uid)) throw new Error('世界书条目编号无效或重复')
        const entry = assignKnownPatch({ uid, key: [], keysecondary: [], comment: '', content: '', disable: false, constant: false, selective: true, order: 100, position: 0, extensions: {} }, object(operation.entry) || {}, identified.format)
        book.entries[String(uid)] = entry
        continue
      }
      const key = str(operation.ref).replace(/^entry:/, '')
      if (!Object.prototype.hasOwnProperty.call(book.entries, key)) throw new Error('世界书条目不存在: ' + operation.ref)
      if (op === 'delete') { delete book.entries[key]; continue }
      if (op === 'update') { book.entries[key] = assignKnownPatch(object(book.entries[key]) || {}, object(operation.patch) || {}, identified.format); continue }
    } else {
      if (op === 'add') {
        const id = operation.uid === undefined ? nextId(book.entries, 'id') : operation.uid
        if (!Number.isSafeInteger(id) || id < 0 || book.entries.some(entry => Number(entry.id) === id)) throw new Error('世界书条目编号无效或重复')
        const entry = assignKnownPatch({ id, keys: [], secondary_keys: [], comment: '', content: '', enabled: true, constant: false, selective: false, insertion_order: 100, position: 'after_char', extensions: {} }, object(operation.entry) || {}, identified.format)
        book.entries.push(entry)
        continue
      }
      const index = Number(str(operation.ref).replace(/^entry:/, ''))
      if (!Number.isInteger(index) || index < 0 || index >= book.entries.length) throw new Error('世界书条目不存在: ' + operation.ref)
      if (op === 'delete') { book.entries.splice(index, 1); continue }
      if (op === 'update') { book.entries[index] = assignKnownPatch(object(book.entries[index]) || {}, object(operation.patch) || {}, identified.format); continue }
    }
    throw new Error('未知世界书操作: ' + op)
  }
  return { document: source, view: inspectWorldBookDocument(source) }
}

export function prepareWorldBookImport(payload) {
  const name = str(payload && payload.name).trim() || '未命名世界书.json'
  const text = str(payload && payload.text)
  let parsed
  try { parsed = JSON.parse(text) } catch (error) { throw new Error('世界书 JSON 无效: ' + error.message) }
  const identified = identifyDocument(parsed)
  const working = clone(identified.book)
  const view = inspectWorldBookDocument(working, { filename: name })
  if (!str(working.name).trim()) working.name = view.displayName
  return { name, originalText: text, working, view: inspectWorldBookDocument(working, { filename: name }) }
}
