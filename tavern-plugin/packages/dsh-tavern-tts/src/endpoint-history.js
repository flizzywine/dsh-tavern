import { randomUUID } from 'node:crypto'

// 最近用过的连接: per saved service, the last ENDPOINT_HISTORY_LIMIT {网址, 密钥} pairs it worked with, the latest first, so
// one service can move between sources (a model on this machine, the official cloud, a relay) by picking a pair. The list
// holds keys, so all of it is one credential of the DSH credential store (`ref`): never settings, logs, exports or cards.
// Readers get each key's last 4 characters only; the full pair leaves this module through take() alone, for a switch.
export const ENDPOINT_HISTORY_LIMIT = 5
const LABEL_MAX = 30
const hostOf = url => { try { return new URL(url).host } catch { return url } }
const tail = key => key && key.length >= 8 ? key.slice(-4) : ''

export function endpointHistory(credentials, ref, { now = Date.now, newId = () => randomUUID().slice(0, 8) } = {}) {
  const read = async () => {
    const raw = (await credentials()?.resolve(ref))?.value
    return raw ? JSON.parse(raw) : []
  }
  const write = async list => {
    const c = credentials()
    if (!c) throw Object.assign(new Error('CREDENTIALS_REQUIRED'), { code: 'CREDENTIALS_REQUIRED' })
    if (list.length) await c.set(ref, JSON.stringify(list)); else await c.unset(ref)
  }
  const find = (list, id) => {
    const entry = list.find(e => e.id === id)
    if (!entry) throw Object.assign(new Error('ENDPOINT_NOT_FOUND'), { code: 'ENDPOINT_NOT_FOUND' })
    return entry
  }
  return {
    // `current`: the service's own {url, key} now; the pair equal to it is marked `current`.
    async list(current) {
      return (await read()).map(e => ({ id: e.id, label: e.label || hostOf(e.url), url: e.url, keyTail: tail(e.key), keyed: !!e.key, usedAt: e.usedAt,
        ...(current && e.url === current.url && e.key === (current.key || '') ? { current: true } : {}) }))
    },
    // A pair that just worked (or is added by name) goes first; the oldest beyond the limit drops off. Already first under
    // that name: nothing is written. `label` names it (an empty one keeps the name it has).
    async remember({ url, key = '', label }) {
      const list = await read(), at = list.findIndex(e => e.url === url && e.key === key)
      const name = String(label ?? '').trim().slice(0, LABEL_MAX)
      if (at === 0 && (!name || list[0].label === name)) return false
      const entry = { ...(at >= 0 ? list[at] : { id: newId(), url, key }), usedAt: now(), ...(name ? { label: name } : {}) }
      await write([entry, ...list.filter((_, i) => i !== at)].slice(0, ENDPOINT_HISTORY_LIMIT))
      return true
    },
    async take(id) { const { url, key } = find(await read(), id); return { url, key } },
    // An empty name goes back to the address's host.
    async rename(id, label) {
      const list = await read(), entry = find(list, id), name = String(label ?? '').trim().slice(0, LABEL_MAX)
      if (name) entry.label = name; else delete entry.label
      await write(list)
    },
    async forget(id) { const list = await read(); find(list, id); await write(list.filter(e => e.id !== id)) },
    async clear() { await write([]) },
  }
}
