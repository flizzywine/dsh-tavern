import { createHash } from 'node:crypto'

// Data third-party plugins keep per game (docs/plugin-design.md §4). Turn data is
// bound to one story text version, so rollback, regeneration and edits need no
// synchronization: a version no longer shown is simply not read. Game data does
// not follow the story. One file per game; each plugin sees only its own part.
const hash = value => createHash('sha256').update(String(value)).digest('hex')
const MAX_RECORD_BYTES = 64 * 1024
const MAX_GAME_BYTES = 256 * 1024
const MAX_RECORDS = 2000
const MAX_OWNER_BYTES = 8 * 1024 * 1024

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_PLUGIN_INVALID' }) }

function encoded(value, limit, label) {
  let text
  try { text = JSON.stringify(value) } catch { throw invalid(label + ' 必须能序列化为 JSON') }
  if (text === undefined) throw invalid(label + ' 必须能序列化为 JSON')
  const bytes = Buffer.byteLength(text)
  if (bytes > limit) throw invalid(label + ' 不能超过 ' + Math.round(limit / 1024) + ' KB')
  return { value: JSON.parse(text), bytes }
}

export function createPluginData({ store, now = Date.now }) {
  const pathFor = chatId => 'plugin-data/' + hash(chatId) + '.json'
  const empty = () => ({ version: 1, owners: {} })
  const valid = value => value && value.version === 1 && value.owners && typeof value.owners === 'object'
  async function read(chatId) {
    const value = await store.readJson(pathFor(chatId))
    return valid(value) ? value : empty()
  }
  async function update(chatId, change) {
    let result
    await store.updateJson(pathFor(chatId), current => {
      const value = valid(current) ? current : empty()
      result = change(value)
      return value
    })
    return result
  }
  const ownerOf = (value, owner) => value.owners[owner] ||= { turns: [], game: null }

  /** Save (or with null, clear) one plugin's data for one turn's text version. */
  async function saveTurn({ chatId, owner, turn, key, data }) {
    const record = data === null ? null : encoded(data, MAX_RECORD_BYTES, 'data')
    return update(chatId, value => {
      const own = ownerOf(value, owner)
      own.turns = own.turns.filter(item => !(item.turn === turn && item.key === key))
      if (record) {
        if (own.turns.length >= MAX_RECORDS) throw invalid('这一局的插件按轮数据已达上限（' + MAX_RECORDS + ' 条）')
        const total = own.turns.reduce((sum, item) => sum + (item.bytes || 0), 0) + record.bytes
        if (total > MAX_OWNER_BYTES) throw invalid('这一局的插件数据总量不能超过 8 MB')
        own.turns.push({ turn, key, data: record.value, bytes: record.bytes, updatedAt: now() })
      }
      return true
    })
  }

  /** One plugin's records at or before a turn, newest turn first. */
  async function turnsUpTo({ chatId, owner, turn }) {
    const own = (await read(chatId)).owners[owner]
    return (own ? own.turns : []).filter(item => item.turn <= turn)
      .sort((a, b) => b.turn - a.turn || b.updatedAt - a.updatedAt)
  }

  async function saveGame({ chatId, owner, data }) {
    const record = data === null ? null : encoded(data, MAX_GAME_BYTES, 'data')
    await update(chatId, value => { ownerOf(value, owner).game = record ? record.value : null })
  }

  async function readGame({ chatId, owner }) {
    const own = (await read(chatId)).owners[owner]
    return own && own.game !== undefined ? structuredClone(own.game) : null
  }

  /** Carry a fork's visible history: records whose version maps into the new game. */
  async function copyForFork({ sourceChatId, targetChatId, keyMap }) {
    const source = await read(sourceChatId)
    const owners = {}
    for (const [owner, own] of Object.entries(source.owners)) {
      const turns = own.turns.flatMap(item => keyMap.get(item.turn + '\u0000' + item.key) ? [{ ...item, key: keyMap.get(item.turn + '\u0000' + item.key) }] : [])
      if (turns.length || own.game !== null) owners[owner] = { turns, game: own.game ?? null }
    }
    if (!Object.keys(owners).length) return 0
    await update(targetChatId, value => { value.owners = owners })
    return Object.values(owners).reduce((sum, own) => sum + own.turns.length, 0)
  }

  /** Turns of a game that hold any plugin data, for building a fork's key map. */
  async function turns(chatId) {
    return Object.values((await read(chatId)).owners).flatMap(own => own.turns.map(item => item.turn))
  }

  async function removeChat(chatId) { await store.remove(pathFor(chatId)) }

  return Object.freeze({ saveTurn, turnsUpTo, saveGame, readGame, copyForFork, turns, removeChat, pathFor })
}
