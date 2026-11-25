const FILE = 'card-organization.json'
const DISPLAY_NAME_LIMIT = 120
const TAG_NAME_LIMIT = 40

const names = list => [...new Set((Array.isArray(list) ? list : []).filter(name => typeof name === 'string' && name.trim()))]

// Version 1 had one group per card (groups / cards[path].group); a group is a tag a card has alone, so a v1 file reads
// as tags here, once. The file keeps groups and each card's group (its first tag) beside the tags, so a build that only
// knows groups still shows every tag list and each card's first tag.
function normalize(value) {
  const tags = names(value?.tags ?? value?.groups)
  const cards = Object.fromEntries(Object.entries(value?.cards || {}).map(([path, item]) => [path, {
    starred: item?.starred === true,
    tags: names(Array.isArray(item?.tags) ? item.tags : [item?.group]).filter(tag => tags.includes(tag)),
    ...(typeof item?.displayName === 'string' && item.displayName.trim() ? { displayName: item.displayName.trim() } : {})
  }]))
  return { tags, cards }
}

function serialize(state) {
  return {
    version: 2, tags: state.tags, groups: state.tags,
    cards: Object.fromEntries(Object.entries(state.cards).map(([path, card]) => [path, { ...card, group: card.tags[0] || '' }]))
  }
}

function tagList(value, known) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string')) throw new Error('标签必须是文字列表')
  const list = names(value)
  if (list.some(tag => !known.includes(tag))) throw new Error('标签不存在，请刷新列表')
  return list
}

/** Local library organization (tags, stars, display names), kept separate from exported author content. */
export function createCardOrganization(store) {
  const read = async () => normalize(await store.readJson(FILE))
  async function update(input, availablePaths) {
    return normalize(await store.updateJson(FILE, current => {
      const state = normalize(current)
      const name = String(input.name || '').trim()
      const requireName = () => {
        if (!name || name.length > TAG_NAME_LIMIT) throw new Error('标签名称请填写 1–' + TAG_NAME_LIMIT + ' 个字符')
        if (state.tags.includes(name)) throw new Error('已有同名标签')
      }
      if (input.action === 'create') {
        requireName()
        state.tags.push(name)
      } else if (input.action === 'rename' || input.action === 'delete') {
        if (!state.tags.includes(input.tag)) throw new Error('标签不存在，请刷新列表')
        if (input.action === 'rename') requireName()
        state.tags = state.tags.flatMap(tag => tag !== input.tag ? [tag] : input.action === 'rename' ? [name] : [])
        for (const card of Object.values(state.cards)) {
          card.tags = card.tags.flatMap(tag => tag !== input.tag ? [tag] : input.action === 'rename' ? [name] : [])
        }
      } else if (input.action === 'cards') {
        if (!Array.isArray(input.paths) || !input.paths.length || input.paths.some(path => !availablePaths.includes(path))) throw new Error('请选择有效的人物卡')
        const tags = tagList(input.tags, state.tags), add = tagList(input.addTags, state.tags), remove = tagList(input.removeTags, state.tags)
        if (input.starred !== undefined && typeof input.starred !== 'boolean') throw new Error('星标状态无效')
        const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : input.displayName
        if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > DISPLAY_NAME_LIMIT)) {
          throw new Error('人物卡展示名最多 ' + DISPLAY_NAME_LIMIT + ' 个字符')
        }
        for (const path of input.paths) {
          const card = state.cards[path] || { starred: false, tags: [] }
          if (tags) card.tags = tags
          if (add) card.tags = names([...card.tags, ...add])
          if (remove) card.tags = card.tags.filter(tag => !remove.includes(tag))
          if (input.starred !== undefined) card.starred = input.starred
          if (displayName) card.displayName = displayName
          if (displayName === '') delete card.displayName
          state.cards[path] = card
        }
      } else throw new Error('未知的人物卡整理操作')
      return serialize(state)
    }))
  }
  async function movePath(from, to) {
    await store.updateJson(FILE, current => {
      const state = normalize(current)
      if (state.cards[from]) {
        if (to) state.cards[to] = state.cards[from]
        delete state.cards[from]
      }
      return serialize(state)
    })
  }
  async function project(cards) {
    const state = await read()
    return cards.map(card => ({ ...card, ...(state.cards[card.path] || { starred: false, tags: [] }) }))
      .sort((a, b) => Number(b.starred) - Number(a.starred))
  }
  return { read, update, movePath, project }
}
