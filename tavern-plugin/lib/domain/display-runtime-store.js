// Latest iframe DOM/console/network capture per game turn. It is diagnostic
// evidence, not story state: it lives outside the versioned save so frames that
// repaint every few seconds do not add a save revision each time. The save
// keeps only a small receipt (which panels exist and whether they read MVU).
const MAX_TURNS = 20

export function displayRuntimeReceipt(frames) {
  return {
    version: 2,
    frames: (Array.isArray(frames) ? frames : []).map(frame => ({
      partIndex: Math.max(0, Number(frame?.partIndex) || 0),
      panelId: typeof frame?.panelId === 'string' ? frame.panelId : '',
      placement: frame?.placement === 'sidebar' ? 'sidebar' : 'message',
      ...(frame?.mvuViewUsed === true ? { mvuViewUsed: true } : {})
    })).sort((a, b) => a.partIndex - b.partIndex || (a.panelId < b.panelId ? -1 : a.panelId > b.panelId ? 1 : 0))
  }
}

export function createDisplayRuntimeStore({ store }) {
  const tails = new Map()
  const pathOf = chatId => 'display-runtime/' + String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'
  function serialize(chatId, operation) {
    const next = (tails.get(chatId) || Promise.resolve()).then(operation, operation)
    const tail = next.catch(() => {})
    tails.set(chatId, tail)
    tail.then(() => { if (tails.get(chatId) === tail) tails.delete(chatId) })
    return next
  }
  async function readAll(chatId) {
    const value = await store.readJson(pathOf(chatId)).catch(() => undefined)
    return value && value.version === 1 && value.turns && typeof value.turns === 'object' ? value : { version: 1, turns: {} }
  }
  return {
    async read(chatId, turn) { return (await readAll(chatId)).turns[String(turn)] },
    async recent(chatId) { return (await readAll(chatId)).turns },
    // Replace one frame atomically; `reset` starts the turn over (a new reply).
    async mergeFrame(chatId, turn, frame, { reset = false, sourceActivityAt = 0, seed = [] } = {}) {
      return serialize(chatId, async () => {
        const value = await readAll(chatId)
        const current = !reset && value.turns[String(turn)] || { sourceActivityAt, frames: seed }
        const same = item => Number(item?.partIndex) === Number(frame.partIndex) && String(item?.panelId || '') === String(frame.panelId || '')
        value.turns[String(turn)] = { sourceActivityAt: current.sourceActivityAt || sourceActivityAt,
          frames: [...(current.frames || []).filter(item => !same(item)), frame].sort((a, b) => a.partIndex - b.partIndex) }
        const turns = Object.keys(value.turns).map(Number).sort((a, b) => b - a)
        for (const old of turns.slice(MAX_TURNS)) delete value.turns[String(old)]
        await store.writeJson(pathOf(chatId), value)
      })
    },
    async remove(chatId) { return serialize(chatId, () => store.remove(pathOf(chatId))) }
  }
}
