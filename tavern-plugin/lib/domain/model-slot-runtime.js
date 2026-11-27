import { readBackgroundModelReasoning } from './background-model-selection.js'
import { createModelSlotRegistry } from './model-slot-registry.js'
import { CORE_MODEL_MANIFESTS, modelSlotRows, resolveModelSlotOffered } from './model-slots.js'

export function createModelSlotRuntime({ readTavernSettings, backgroundConfigForSession, modelSelection, llm, warn }) {
  const modelSlots = createModelSlotRegistry({ warn })
  const registerCore = () => modelSlots.register('core', { rows: () => modelSlotRows(CORE_MODEL_MANIFESTS, CORE_MODEL_MANIFESTS.map(row => row.id)) })

  function scoringCatalog() {
    const config = modelSlots.scoring()
    return config && config.provider !== 'unset' ? [{ provider: config.provider, model: config.model }] : []
  }

  async function slotDeclarations(context) {
    return modelSlots.rows(context)
  }
  async function resolveSlot(modId, slotId, sessionId, declaration) {
    const slot = declaration || (await modelSlots.rows()).find(row => row.modId === modId && row.id === slotId)
    if (!slot) throw new Error('模型槽未启用')
    const settings = await readTavernSettings()
    const chat = sessionId ? await backgroundConfigForSession(sessionId) || {} : {}
    return resolveModelSlotOffered({
      slot, modId, chat, settings,
      foreground: sessionId ? modelSelection(sessionId, false) : null,
      defaultModel: slot.kind === 'scoring' ? null : modelSelection(),
      scoringConfig: modelSlots.scoring()
    }, async selection => (await readBackgroundModelReasoning(llm, selection))?.efforts)
  }
  async function checkSlotSelection({ modId, slotId, selection }, context) {
    const slot = (await modelSlots.rows(context)).find(row => row.modId === modId && row.id === slotId)
    if (!slot) throw new Error('模型槽未启用')
    if (selection === null) return
    if (slot.kind === 'scoring') {
      const config = modelSlots.scoring()
      if (!config || selection.provider !== config.provider || selection.model !== config.model) throw new Error('请选择已配置的概率判断模型')
    } else {
      const { reasoningEffort, ...route } = selection
      await llm.resolveCallConfig(reasoningEffort === null ? route : selection)
    }
  }

  return { modelSlots, registerCore, scoringCatalog, slotDeclarations, resolveSlot, checkSlotSelection }
}
