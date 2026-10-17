import { computeSceneTarget } from './scene-illustration.js'
import { sceneSlotKeys } from './scene-slots.js'

/** The scene module owns all picture keys, including extra slots and retained history. */
export function sceneSaveKeyMap(states, targetChatId) {
  const result = new Map()
  for (const state of states) {
    for (const message of state.messages || []) {
      if (message?.role !== 'assistant') continue
      const turn = Number(message.turn || (message.greeting ? 1 : 0))
      let oldKey, newKey
      try {
        oldKey = computeSceneTarget(state, turn).key
        newKey = computeSceneTarget({ ...state, id: targetChatId }, turn).key
      } catch { continue } // Non-story messages have no illustration target.
      const oldSlots = sceneSlotKeys([oldKey]), newSlots = sceneSlotKeys([newKey])
      oldSlots.forEach((key, index) => result.set(key, newSlots[index]))
    }
  }
  return result
}
