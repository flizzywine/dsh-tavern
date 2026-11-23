const FILE = 'card-organization.json'
const DISPLAY_NAME_LIMIT = 120

function normalize(value) {
  const groups = [...new Set((Array.isArray(value?.groups) ? value.groups : []).filter(name => typeof name === 'string' && name.trim()))]
  const cards = Object.fromEntries(Object.entries(value?.cards || {}).map(([path, item]) => [path, {
    starred: item?.starred === true,
    group: groups.includes(item?.group) ? item.group : '',
    ...(typeof item?.displayName === 'string' && item.displayName.trim() ? { displayName: item.displayName.trim() } : {})
  }]))
  return { version: 1, groups, cards }
}

/** Local library organization, kept separate from exported author content. */
export function createCardOrganization(store) {
  const read = async () => normalize(await store.readJson(FILE))
  async function update(input, availablePaths) {
    return store.updateJson(FILE, current => {
      const state = normalize(current)
      const name = String(input.name || '').trim()
      const requireName = () => {
        if (!name || name.length > 80) throw new Error('分组名称请填写 1–80 个字符')
        if (state.groups.includes(name)) throw new Error('已有同名分组')
      }
      if (input.action === 'create') {
        requireName()
        state.groups.push(name)
      } else if (input.action === 'rename' || input.action === 'delete') {
        if (!state.groups.includes(input.group)) throw new Error('分组不存在，请刷新列表')
        if (input.action === 'rename') requireName()
        state.groups = state.groups.flatMap(group => group !== input.group ? [group] : input.action === 'rename' ? [name] : [])
        for (const card of Object.values(state.cards)) {
          if (card.group === input.group) card.group = input.action === 'rename' ? name : ''
        }
      } else if (input.action === 'cards') {
        if (!Array.isArray(input.paths) || !input.paths.length || input.paths.some(path => !availablePaths.includes(path))) throw new Error('请选择有效的人物卡')
        if (input.group !== undefined && input.group !== '' && !state.groups.includes(input.group)) throw new Error('分组不存在，请刷新列表')
        if (input.starred !== undefined && typeof input.starred !== 'boolean') throw new Error('星标状态无效')
        const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : input.displayName
        if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > DISPLAY_NAME_LIMIT)) {
          throw new Error('人物卡展示名最多 ' + DISPLAY_NAME_LIMIT + ' 个字符')
        }
        for (const path of input.paths) {
          const card = state.cards[path] || { starred: false, group: '' }
          if (input.group !== undefined) card.group = input.group
          if (input.starred !== undefined) card.starred = input.starred
          if (displayName) card.displayName = displayName
          if (displayName === '') delete card.displayName
          state.cards[path] = card
        }
      } else throw new Error('未知的人物卡整理操作')
      return state
    })
  }
  async function movePath(from, to) {
    await store.updateJson(FILE, current => {
      const state = normalize(current)
      if (state.cards[from]) {
        if (to) state.cards[to] = state.cards[from]
        delete state.cards[from]
      }
      return state
    })
  }
  async function project(cards) {
    const state = await read()
    return cards.map(card => ({ ...card, ...(state.cards[card.path] || { starred: false, group: '' }) }))
      .sort((a, b) => Number(b.starred) - Number(a.starred))
  }
  return { read, update, movePath, project }
}
