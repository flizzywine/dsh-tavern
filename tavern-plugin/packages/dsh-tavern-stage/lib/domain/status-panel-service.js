// Pages are read live from the library card, not the game's frozen snapshot.
import { rawData } from '../../../../lib/domain/card-preparation.js'
import { readLedger } from '../../../../lib/domain/story-ledger.js'
import { locateCardPageAsset, listCardPageAssets } from './card-page-assets.js'

const LEDGER_BUDGET = 12288
const bytes = value => Buffer.byteLength(JSON.stringify(value))

// Only the declared ledger sections (checked when the card was written, card-status-panel.js); the longest list is trimmed from its end until the projection fits the budget.
export function projectStatusPanelLedger(ledger, sections = []) {
  const out = {}
  for (const name of sections) out[name] = ledger[name]
  while (bytes(out) > LEDGER_BUDGET) {
    const longest = Object.values(out).filter(Array.isArray).reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), null)
    if (!longest?.length) break
    longest.pop()
  }
  return out
}

export function createCardPagesService({ readWorkspace, chatForSession, index, packSnapshot }) {
  async function context(sessionId) {
    const chat = await chatForSession(sessionId)
    if (!chat || chat.mode === 'card') return null
    const workspace = await readWorkspace(chat.cardPath)
    const card = workspace?.raw && rawData(workspace.raw)
    const extension = card?.extensions?.dsh_tavern
    return { chat, card, pages: extension?.pages || [], packs: extension?.assetBindings?.boundPackIds || [] }
  }
  return Object.freeze({
    async list({ sessionId } = {}) {
      const value = await context(sessionId)
      if (!value?.pages.length) return { pages: [], fresh: false }
      const indexed = await index(sessionId)
      return {
        pages: value.pages.map(({ id, label, shortcut, menu, showOn, initial, size = 'window', closeControl }) => ({
          id, label, size, ...(closeControl !== undefined ? { closeControl } : {}),
          ...(shortcut !== undefined ? { shortcut } : {}), ...(menu !== undefined ? { menu } : {}),
          ...(showOn !== undefined ? { showOn } : {}), ...(initial !== undefined ? { initial } : {})
        })),
        fresh: !(indexed?.messages || []).some(message => message.role === 'user')
      }
    },
    async read({ sessionId, page, withHtml } = {}) {
      const value = await context(sessionId)
      const definition = value?.pages.find(item => item.id === page)
      if (!definition) return null
      return {
        id: definition.id, label: definition.label, size: definition.size || 'window',
        figures: definition.figures || [], card: { name: value.card.name },
        preload: await Promise.all((definition.preload || []).map(async ref => ({ ref, place: await locateCardPageAsset(packSnapshot, value.packs, ref) }))),
        ...(withHtml === true ? { html: definition.html } : {}),
        data: { ledger: projectStatusPanelLedger(readLedger(value.chat.ledger), definition.ledger) }
      }
    },
    async locate({ sessionId, page, ref } = {}) {
      const value = await context(sessionId)
      return value?.pages.some(item => item.id === page) ? locateCardPageAsset(packSnapshot, value.packs, ref) : null
    },
    async assets({ sessionId, page, kind } = {}) {
      const value = await context(sessionId)
      return value?.pages.some(item => item.id === page) ? listCardPageAssets(packSnapshot, value.packs, kind) : []
    }
  })
}
