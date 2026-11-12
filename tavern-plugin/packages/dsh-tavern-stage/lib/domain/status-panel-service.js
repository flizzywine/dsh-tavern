// Pages are read live from the library card, not the game's frozen snapshot.
import { rawData } from '../../../../lib/domain/card-preparation.js'
import { readLedger } from '../../../../lib/domain/story-ledger.js'
import { locateCardPageAsset, listCardPageAssets } from './card-page-assets.js'

const LEDGER_BUDGET = 12288
const USER = '{{user}}'
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

// cardPageOpening: the core's projection of a card's opening page (lib/domain/card-page-opening.js, via the stage core contract).
export function createCardPagesService({ readWorkspace, chatForSession, index, packSnapshot, cardPageOpening }) {
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
        pages: value.pages.map(({ id, label, shortcut, menu, showOn, initial, opening, size = 'window', closeControl }) => ({
          id, label, size, ...(closeControl !== undefined ? { closeControl } : {}),
          ...(shortcut !== undefined ? { shortcut } : {}), ...(menu !== undefined ? { menu } : {}),
          ...(showOn !== undefined ? { showOn } : {}), ...(initial !== undefined ? { initial } : {}), ...(opening !== undefined ? { opening } : {})
        })),
        // never played: no player message, and not a game set up before it began (an opening page's kept greeting)
        fresh: value.chat.openingPrepared !== true && !(indexed?.messages || []).some(message => message.role === 'user')
      }
    },
    async read({ sessionId, page, withHtml } = {}) {
      const value = await context(sessionId)
      const definition = value?.pages.find(item => item.id === page)
      if (!definition) return null
      return {
        id: definition.id, label: definition.label, size: definition.size || 'window',
        // {{user}} is the player's name in this chat (an agent sheet shows the player's own face from the library)
        figures: (definition.figures || []).map(figure => figure.name === USER ? { ...figure, name: value.chat.macroState?.userName?.trim() || figure.name } : figure),
        card: { name: value.card.name },
        preload: await Promise.all((definition.preload || []).map(async ref => ({ ref, place: await locateCardPageAsset(packSnapshot, value.packs, ref) }))),
        ...(withHtml === true ? { html: definition.html } : {}),
        data: { ledger: projectStatusPanelLedger(readLedger(value.chat.ledger), definition.ledger) }
      }
    },
    // The card's opening page (opening: true) reads the card's greetings and the openingSetup it completes.
    async opening({ sessionId, page, userName } = {}) {
      const value = await context(sessionId)
      if (!value) return null
      return cardPageOpening(value.card, { page, userName: String(userName ?? '').trim().slice(0, 80) || value.chat.macroState?.userName || '你' })
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
