import { projectAgentContent } from './runtime-content-projection.js'
import { historyScanDepth } from './worldbook-activation.js'
import { isMvuUpdateEntry, isWorldBookTemplateEntry, projectWorldBookTemplates } from './worldbook-recall.js'
import { withPluginWorldbookEntries } from './plugin-worldbook.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'
import { hasTavernHelperVariableMacro } from './tavern-helper-variable-macros.js'
import { projectMvuNpcRegistration } from './mvu-npc-registration.js'
import { isIdentityOnlyConstant, withIdentityNames } from './worldbook-entry-classification.js'
import { deliveredBubbleEntries } from './dialogue-bubbles.js'

// A constant that only names the player or the card reads as plain text with this game's names: it is a static
// constant in the fixed prefix every turn, and a rename changes that prefix once (the next request reads the new name).
function withGameNames(record, chat, card) {
  const entries = record?.view?.entries
  if (!entries?.some(isIdentityOnlyConstant)) return record
  const names = { user: chat?.macroState?.userName || '你', char: String(card?.name ?? chat?.cardName ?? '') }
  return { ...record, view: { ...record.view, entries: entries.map(entry => isIdentityOnlyConstant(entry) ? withIdentityNames(entry, names) : entry) } }
}

// 对话气泡 entries: the ones the game delivers as text (deliveredBubbleEntries), by this card's 对话气泡.
async function withDeliveredBubbles(record, chat, cardBubbles) {
  const entries = record?.view?.entries
  if (!entries?.some(entry => entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles)) return record
  return { ...record, view: { ...record.view, entries: deliveredBubbleEntries(entries, chat?.cardPath, await cardBubbles(chat?.cardPath)) } }
}

// The world book a game plays with, as the background and recall read it. cardBubbles(cardPath): the card's
// 对话气泡, 'on' | 'off' | null (card-stage-settings.js cardBubbleChoice).
export function createPlayWorldBook({ worldBooks, readChatCard, poolEntries, readOnlyTemplateRuntime, globalVariables = async () => ({}), cardBubbles = async () => null }) {
  async function mvuUpdateRules(chat, card, target) {
    const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
    const cardEntries = card?.character_book?.entries && typeof card.character_book.entries === 'object'
      ? inspectWorldBookDocument(card.character_book).entries.map(entry => ({ ...entry, ref: 'card-mvu:' + entry.ref, sourceUid: 'card-mvu:' + entry.sourceUid }))
      : []
    // A standalone binding can replace the embedded book in bound(). Settlement
    // still needs the card's own rules, once each when the book is also bound.
    const seen = new Set()
    const enabledRules = [...cardEntries, ...(worldBook?.view?.entries || [])].filter(entry => {
      if (entry.enabled === false || !isMvuUpdateEntry(entry)) return false
      const content = entry.content?.trim()
      if (!content || seen.has(content)) return false
      seen.add(content)
      return true
    })
    const options = { charName: card?.name, macroState: chat.macroState }
    const entries = projectMvuNpcRegistration(enabledRules, { chat, target, projection: options })
    if (!entries.some(entry => isWorldBookTemplateEntry(entry) || hasTavernHelperVariableMacro(entry.content))) {
      return entries.map(entry => projectAgentContent(entry.content, options).agentText).filter(Boolean)
    }
    // Render only settlement rules in a read-only projection. Never run ordinary
    // worldbook controllers again or send failed templates to the model as code.
    const projected = await projectWorldBookTemplates({ worldBook, selectedEntries: entries,
      mvuUpdateOnly: true, includeConstants: true, runtime: await readOnlyTemplateRuntime(chat.sessionId),
      globalVariables: await globalVariables(), chat, card, messageVariables: target?.variables })
    if (projected.diagnostics.length) throw new Error('MVU 更新规则模板执行失败：' + projected.diagnostics.map(item => item.ref + ' (' + item.code + ')').join('、'))
    return projected.renderedEntries.map(entry => entry.text)
  }
  // An unreadable book has no known depth: callers then use the complete read.
  async function worldBookScanDepth(chat) {
    try { return historyScanDepth(await worldBooks.bound(chat.cardPath, await readChatCard(chat), chat)) }
    catch { return Infinity }
  }
  // What recall, world book search and screening read: the bound book plus plugin entries (tavern.worldbookEntries).
  async function playWorldBook(chat, card) {
    const record = await worldBooks.bound(chat.cardPath, card, chat)
    const played = await withDeliveredBubbles(record, chat, cardBubbles)
    if (!chat?.sessionId) return withGameNames(played, chat, card)
    const turn = Number([...(chat.messages || [])].reverse().find(message => message?.role === 'assistant')?.turn) || 0
    return withGameNames(withPluginWorldbookEntries(played, await poolEntries({ gameId: chat.sessionId, turn })), chat, card)
  }

  return { playWorldBook, worldBookScanDepth, mvuUpdateRules }
}
