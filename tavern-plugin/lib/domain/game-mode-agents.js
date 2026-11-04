import { pluginMember, pluginMemberId } from './background-members.js'

// Stable child identity is transport state, not game memory. Every request
// rebuilds the actor's knowledge from the plugin's current projected context.
export function createGameModeAgents({ data, resolveGame, runTask }) {
  return async input => {
    const { member: name, ...task } = input
    const isolated = { tools: [], call: () => { throw new Error('玩法 Agent 没有工具') } }
    if (name === undefined) return runTask({ ...task, ...isolated })
    const member = pluginMemberId(input.owner, name)
    if (!pluginMember(member)) throw new Error('玩法成员尚未注册：' + name)
    const { chatId } = await resolveGame(input.gameId)
    return runTask({ ...task, ...isolated, member,
      rewindTo: -1, rewindFormatVersion: 4,
      resolvePersistentSessionId: () => data.readModeAgent(chatId, input.gameId, member),
      onPersistentSessionReady: sessionId => data.writeModeAgent(chatId, input.gameId, member, sessionId),
    })
  }
}
