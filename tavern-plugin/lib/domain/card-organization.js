const DISPLAY_NAME_LIMIT = 120
const TAG_NAME_LIMIT = 40

const names = list => [...new Set((Array.isArray(list) ? list : []).filter(name => typeof name === 'string' && name.trim()))]

function tagList(value, known, label) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string')) throw new Error(label + '必须是文字列表')
  const list = names(value)
  if (list.some(tag => !known.includes(tag))) throw new Error(label + '不存在，请刷新列表')
  return list
}

function createLibraryOrganization(store, { kind, itemLabel, tagLabel }) {
  const file = kind + '-organization.json', key = kind + 's'
  const isCard = kind === 'card'
  // A version 1 card group becomes a tag. Version 2 keeps the legacy group fields for older builds.
  function normalize(value) {
    const tags = names(value?.tags ?? (isCard ? value?.groups : undefined))
    const entries = Object.fromEntries(Object.entries(value?.[key] || {}).map(([path, item]) => [path, {
      tags: names(isCard && !Array.isArray(item?.tags) ? [item?.group] : item?.tags).filter(tag => tags.includes(tag)),
      ...(isCard ? { starred: item?.starred === true } : {}),
      ...(isCard && typeof item?.displayName === 'string' && item.displayName.trim() ? { displayName: item.displayName.trim() } : {})
    }]))
    return { tags, [key]: entries }
  }
  function serialize(state) {
    if (!isCard) return { version: 1, ...state }
    return {
      version: 2, tags: state.tags, groups: state.tags,
      cards: Object.fromEntries(Object.entries(state.cards).map(([path, card]) => [path, { ...card, group: card.tags[0] || '' }]))
    }
  }
  const empty = () => ({ tags: [], ...(isCard ? { starred: false } : {}) })
  const read = async () => normalize(await store.readJson(file))
  async function update(input, availablePaths) {
    return normalize(await store.updateJson(file, current => {
      const state = normalize(current)
      const entries = state[key]
      const name = String(input.name || '').trim()
      const requireName = () => {
        if (!name || name.length > TAG_NAME_LIMIT) throw new Error(tagLabel + '名称请填写 1–' + TAG_NAME_LIMIT + ' 个字符')
        if (state.tags.includes(name)) throw new Error('已有同名' + tagLabel)
      }
      if (input.action === 'create') {
        requireName()
        state.tags.push(name)
      } else if (input.action === 'rename' || input.action === 'delete') {
        if (!state.tags.includes(input.tag)) throw new Error(tagLabel + '不存在，请刷新列表')
        if (input.action === 'rename') requireName()
        state.tags = state.tags.flatMap(tag => tag !== input.tag ? [tag] : input.action === 'rename' ? [name] : [])
        for (const item of Object.values(entries)) {
          item.tags = item.tags.flatMap(tag => tag !== input.tag ? [tag] : input.action === 'rename' ? [name] : [])
        }
      } else if (input.action === key) {
        if (!Array.isArray(input.paths) || !input.paths.length || input.paths.some(path => !availablePaths.includes(path))) throw new Error('请选择有效的' + itemLabel)
        const tags = tagList(input.tags, state.tags, tagLabel), add = tagList(input.addTags, state.tags, tagLabel), remove = tagList(input.removeTags, state.tags, tagLabel)
        if (isCard && input.starred !== undefined && typeof input.starred !== 'boolean') throw new Error('星标状态无效')
        const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : input.displayName
        if (isCard && displayName !== undefined && (typeof displayName !== 'string' || displayName.length > DISPLAY_NAME_LIMIT)) {
          throw new Error('人物卡展示名最多 ' + DISPLAY_NAME_LIMIT + ' 个字符')
        }
        for (const path of input.paths) {
          const item = entries[path] || empty()
          if (tags) item.tags = tags
          if (add) item.tags = names([...item.tags, ...add])
          if (remove) item.tags = item.tags.filter(tag => !remove.includes(tag))
          if (isCard) {
            if (input.starred !== undefined) item.starred = input.starred
            if (displayName) item.displayName = displayName
            if (displayName === '') delete item.displayName
          }
          entries[path] = item
        }
      } else throw new Error('未知的' + itemLabel + '整理操作')
      return serialize(state)
    }))
  }
  async function movePath(from, to) {
    if (from === to) return
    await store.updateJson(file, current => {
      const state = normalize(current)
      const entries = state[key]
      if (!entries[from]) return current
      if (to) entries[to] = entries[from]
      delete entries[from]
      return serialize(state)
    })
  }
  async function project(items) {
    const state = await read()
    const projected = items.map(item => ({ ...item, ...(state[key][item.path] || empty()) }))
    return isCard ? projected.sort((a, b) => Number(b.starred) - Number(a.starred)) : projected
  }
  return { read, update, movePath, project }
}

export function createCardOrganization(store) {
  return createLibraryOrganization(store, { kind: 'card', itemLabel: '人物卡', tagLabel: '标签' })
}

export function createScriptOrganization(store) {
  return createLibraryOrganization(store, { kind: 'script', itemLabel: '剧本', tagLabel: '分组' })
}
