import { HISTORY_RECALL_OUTPUT_SCHEMA, HISTORY_RECALL_TOOL, renderHistoryRecall } from '../domain/history-recall.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshParameterFields } from '../domain/dsh-tool-schema.js'
import { surfaceToolResults } from '../domain/surface-tool-results.js'
import { settledVariables } from '../domain/read-variables.js'
import { cardOffer } from '../mod-tools.js'

export function registerGameplayTools({
  modTools = [],
  authorizeMod,
  markModToolUsed,
  activeTurnOf,
  chatForSession,
  isBackground,
  readChatCard = async () => undefined,
  foregroundRecallScopes,
  recallHistoryForSession,
  tools,
}) {
  // The mods' foreground tools (lib/mod-tools.js), each authorized and marked under its own mod. readCard(chat) is the
  // card the game plays with; results(exec) the tool's own earlier results on the game's current branch;
  // variables(chat) the game's latest settled MVU stat_data and the turn it belongs to ({snapshot, turn}): results of later turns
  // are not in it yet.
  for (const tool of modTools) tools.register(defineTool(tool.create({ activeTurnOf, chatForSession, isBackground,
    authorize: async chat => { const from = cardOffer(tool, await readChatCard(chat)); return from === 'card' || (from === null && authorizeMod(tool.modId, chat)) },
    markUsed: chat => markModToolUsed(chat, tool.name),
    readCard: chat => readChatCard(chat), results: exec => surfaceToolResults(exec?.agent?.session, tool.name, activeTurnOf(exec)),
    variables: chat => settledVariables(chat) })))
  tools.register(defineTool({
    name: HISTORY_RECALL_TOOL.name,
    description: HISTORY_RECALL_TOOL.description,
    parameters: dshParameterFields(HISTORY_RECALL_TOOL.parameters),
    output: {
      schema: HISTORY_RECALL_OUTPUT_SCHEMA,
      render: function (_args, value) { return [{ type: 'text', text: renderHistoryRecall(value) }] }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const session = exec?.agent?.session
      const turn = activeTurnOf(exec)
      let scope
      if (session && turn > 0) {
        scope = foregroundRecallScopes.get(session)
        if (!scope || scope.turn !== turn) {
          scope = { turn }
          foregroundRecallScopes.set(session, scope)
        }
      }
      return await recallHistoryForSession(sessionId, args, scope, 'foreground')
    }
  }))
}
