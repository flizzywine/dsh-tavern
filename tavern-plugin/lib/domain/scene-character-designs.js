import { createHash } from 'node:crypto'
import { CHARACTER_DESIGN_READ_TOOL_NAME, createCharacterDesignDocumentSession } from './character-design-document.js'
import { projectAgentContent } from './runtime-content-projection.js'

// Reuse the existing reader against a frozen, turn-local document. No save path
// is exposed, and a missing historical snapshot never falls back to today's chat.
export function createSceneCharacterDesigns({ snapshot, target, sources }) {
  const project = value => {
    if (typeof value === 'string') return projectAgentContent(value, { macroState: snapshot?.macroState }).agentText
    if (Array.isArray(value)) return value.map(project)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, project(item)]))
    return value
  }
  const message = snapshot?.messages?.find(item => item.role === 'assistant' && Number(item.turn || (item.greeting ? 1 : 0)) === target.turn)
  const variables = message?.variables?.[target.swipeId]
  const reader = createCharacterDesignDocumentSession({
    document: project(snapshot?.characterDesignDocument),
    currentVariables: variables?.stat_data,
    variableSchema: variables?.schema
  })
  const available = snapshot?.settleStatus === 'done' && Boolean(snapshot.characterDesignDocument)
  const returned = new Map()
  let reads = 0, remaining = 6000
  return {
    async read(args) {
      if (++reads > 3) return { ok: false, sources: [], error: '人物设计最多读取三次，请使用已有材料。' }
      if (!available) return { ok: true, found: false, sources: [], reason: '本轮没有已结算的人物设计快照；不读取后续设定。' }
      const result = JSON.parse(await reader.execute({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: args }))
      const text = JSON.stringify(result)
      const id = 'character-design-' + createHash('sha256').update(text).digest('hex').slice(0, 24)
      if (returned.has(id)) return { ...result, sources: [returned.get(id)] }
      const budget = Math.min(remaining, 12000 - sources.reduce((sum, item) => sum + item.text.length + 2, 0))
      if (text.length + 2 > budget) return { ok: false, sources: [], error: '人物设计超出本轮资料预算，未返回不完整档案。' }
      remaining -= text.length + 2
      if (!result.found) return { ...result, sources: [] }
      const source = { id, turn: target.turn, text, origin: { kind: 'character-design-snapshot', revision: snapshot.characterDesignDocument.revision || 0 } }
      returned.set(id, source)
      return { ...result, sources: [source] }
    }
  }
}
