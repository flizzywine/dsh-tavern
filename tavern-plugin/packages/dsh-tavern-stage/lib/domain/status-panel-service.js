// Status panel definition and bounded data for one session. The definition comes from the library card, never the chat's frozen snapshot.
import { rawData } from '../../../../lib/domain/card-preparation.js'
import { readCardVariableSources } from '../../../../lib/domain/card-variable-bindings.js'
import { projectWidgetVariableValues } from '../../../../lib/domain/widget-variables.js'
import { readLedger } from '../../../../lib/domain/story-ledger.js'

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

export function createStatusPanelService({ readWorkspace, chatForSession, index, readWindow, readRevision }) {
  return Object.freeze({
    async read({ sessionId, withHtml } = {}) {
      const chat = await chatForSession(sessionId)
      if (!chat || chat.mode === 'card') return null
      const workspace = await readWorkspace(chat.cardPath)
      const panel = workspace?.raw ? rawData(workspace.raw).extensions?.dsh_tavern?.statusPanel : undefined
      if (!panel) return null
      const indexed = await index(sessionId)
      const sources = indexed ? await readCardVariableSources({ path: chat.cardPath, indexed, readWindow, readRevision }) : {}
      return {
        title: panel.title || '状态',
        size: panel.size || 'window',
        figures: panel.figures || [],
        ...(withHtml === true ? { html: panel.html } : {}),
        data: {
          variables: projectWidgetVariableValues(panel.variables || { reads: {} }, sources),
          ledger: projectStatusPanelLedger(readLedger(chat.ledger), panel.ledger)
        }
      }
    }
  })
}
