// Trigger words are checked once, when an author writes them (docs/design/asset-library.md「触发词」).
// An entry's words count as written when they differ from the stored ones: a new entry, or an edit of its
// keywords or synonyms. Renaming an entry or switching its lamp does not author its words, so an
// installed pack never starts failing on an unrelated edit. An entry without words is recalled by its name.
const norm = value => String(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
const key = row => row.kind + '/' + row.id
const primary = row => row.recall?.keywords || []
const words = row => [...primary(row), ...Object.values(row.recall?.synonyms || {}).flat()]
const authored = row => JSON.stringify([primary(row), row.recall?.synonyms || {}])
// Words that name a whole group of entries rather than one of them.
const categories = /^(?:演唱|歌曲|音乐|bgm|音效|背景|服装|场景)$/u
const EXAMPLES = Object.freeze({
  music: '离别、毕业、远行；曲名的另一种叫法放进同一个触发词的同义词',
  backgrounds: '教室、黑板、讲台；地点的短名加它独有的东西',
  props: '怀表、表链；物品的短名加它独有的样子'
})

export function lintTriggers(document, { before } = {}) {
  const all = (document.manifest.assets || []).filter(row => row.enabled !== false)
  const old = new Map((before?.manifest.assets || []).map(row => [key(row), row]))
  const touched = row => authored(row) !== (old.has(key(row)) ? authored(old.get(key(row))) : authored({}))
  const usage = new Map()
  for (const row of all) for (const word of new Set(words(row).map(norm))) {
    const id = row.kind + '/' + word
    if (!usage.has(id)) usage.set(id, [])
    usage.get(id).push(row)
  }
  const issues = []
  const add = (row, trigger, rule, detail) => {
    const example = EXAMPLES[row.kind] || EXAMPLES.backgrounds
    issues.push({ entry: key(row), name: row.name || row.id, trigger, rule, example, detail,
      message: `${row.name || row.id} [${key(row)}] 触发词「${trigger}」违反 ${rule}：${detail}。正例：${example}。` })
  }
  for (const row of all.filter(touched)) {
    const list = primary(row).map(norm), unique = new Set(words(row).map(norm))
    if (!list.length) continue
    if (new Set(list).size < 3 || new Set(list).size > 6) add(row, list.join('、'), 'count', '须有 3–6 个触发词；同义词是同一个词的其它叫法，不另占名额')
    for (const word of unique) {
      if (list.filter(w => w === word).length > 1) add(row, word, 'duplicate', '触发词重复')
      if (norm(row.name || '') === word) continue
      // Sound nouns and idioms are prose; a label mechanically appended to an action is not.
      if (/(?:氛围|场景)$|^(?:奔跑|跑步|移动|战斗|攻击|走路)声$/u.test(word)) add(row, word, 'suffix', '不要在动作或情境后面拼接「声」「氛围」「场景」')
      const length = [...word].length
      const long = /\p{Script=Han}/u.test(word) ? length > 4 : length > 32 || word.split(/\s+/).length > 3
      if (length < 2) add(row, word, 'short-word', '单字容易误召回，用短名或具体的事物')
      // A song title, a foreign name or a place may be long; without more to go on, length alone does not reject it.
      else if (long && row.kind !== 'music' && !/[\p{Script=Hiragana}\p{Script=Katakana}·・]/u.test(word) && !/(?:房间|部屋|学校|大学|学园)$/u.test(word)) add(row, word, 'short-word', '一般的正文词用 2–4 个字')
      if (row.kind === 'music' && /(?:乐队|组合|ユニット)$/u.test(word)) add(row, word, 'music-unit', '音乐不用乐队或组合名召回')
      const peers = usage.get(row.kind + '/' + word)
      if (peers.length >= 5 && categories.test(word)) add(row, word, 'group-generic', `同类 ${peers.length} 条共用这个类别词，分不出是哪一条`)
    }
  }
  return { entries: all.length, checked: all.filter(touched).length, violations: issues.length, issues }
}

// The one gate, where a player writes entries (the editor's updateAssetPackEntries, rpc/asset-library.js). The store
// itself does not lint: imports and moves write entries without words, and stored packs are not re-judged.
// `force` publishes anyway and returns what it overrode.
export function enforceTriggers(before, after, force = false) {
  const result = lintTriggers(after, { before })
  if (result.violations && force !== true) {
    throw Object.assign(new Error(result.issues.map(issue => issue.message).join('\n')), { code: 'TRIGGER_LINT', issues: result.issues })
  }
  return result.issues
}
