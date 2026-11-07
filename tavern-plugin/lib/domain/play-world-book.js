import { projectAgentContent } from './runtime-content-projection.js'
import { historyScanDepth } from './worldbook-activation.js'
import { isMvuUpdateEntry, isWorldBookTemplateEntry, projectWorldBookTemplates } from './worldbook-recall.js'
import { withPluginWorldbookEntries } from './plugin-worldbook.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'

// The world book a game plays with, as the background and recall read it.
export function createPlayWorldBook({ worldBooks, readChatCard, pluginApi, runtime, globalVariables = async () => ({}) }) {
  async function mvuUpdateRules(chat, card, target) {
    const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
    const cardEntries = card?.character_book?.entries && typeof card.character_book.entries === 'object'
      ? inspectWorldBookDocument(card.character_book).entries.map(entry => ({ ...entry, ref: 'card-mvu:' + entry.ref, sourceUid: 'card-mvu:' + entry.sourceUid }))
      : []
    // A standalone binding can replace the embedded book in bound(). Settlement
    // still needs the card's own rules, once each when the book is also bound.
    const seen = new Set()
    const entries = [...cardEntries, ...(worldBook?.view?.entries || [])].filter(entry => {
      if (entry.enabled === false || !isMvuUpdateEntry(entry)) return false
      const content = entry.content?.trim()
      if (!content || seen.has(content)) return false
      seen.add(content)
      return true
    })
    if (!entries.some(isWorldBookTemplateEntry)) {
      return entries.map(entry => projectAgentContent(entry.content, { charName: card?.name, macroState: chat.macroState }).agentText).filter(Boolean)
    }
    // Render only settlement rules in a read-only projection. Never run ordinary
    // worldbook controllers again or send failed templates to the model as code.
    const projected = await projectWorldBookTemplates({ worldBook, selectedEntries: entries,
      mvuUpdateOnly: true, includeConstants: true, runtime: await runtime(chat.sessionId),
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
    if (!chat?.sessionId) return record
    const turn = Number([...(chat.messages || [])].reverse().find(message => message?.role === 'assistant')?.turn) || 0
    return withPluginWorldbookEntries(record, await pluginApi.worldbookPoolEntries({ gameId: chat.sessionId, turn }))
  }

  return { playWorldBook, worldBookScanDepth, mvuUpdateRules }
}
