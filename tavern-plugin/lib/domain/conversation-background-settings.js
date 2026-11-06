import { patchConversationBackground } from './conversation-background.js'
import { normalizeBackgroundModel } from './background-model-selection.js'
import { foregroundToolCatalog, normalizeDisabledForegroundTools } from './foreground-tools.js'
import { normalizeConfiguredBackgroundTasks } from './tavern-settings.js'

/** Validate model choices, patch only current configuration and trigger newly enabled work. */
export function createConversationBackgroundSettings({ readConfig, readChat, updateChat, modelCatalog, modelReasoning,
  isPlayMode, extraTools = async () => [],
  worldbookStrategies = { list: () => [{ id: 'native-skills', label: '主动检索' }], has: id => id === 'native-skills' } }) {
  function requirePlay(chat) {
    if (!chat || !isPlayMode(chat.mode)) throw new Error('请先打开游玩会话')
    return chat
  }
  function present(chat) {
    return { backgroundModel: chat.backgroundModelSelection || null,
      worldbookStrategy: (!chat.worldbookStrategy || chat.worldbookStrategy === 'legacy') ? 'native-skills' : chat.worldbookStrategy,
      backgroundTasks: normalizeConfiguredBackgroundTasks(chat.backgroundTasks), webSearchEnabled: chat.webSearchEnabled === true,
      disabledForegroundTools: normalizeDisabledForegroundTools(chat.disabledForegroundTools) }
  }
  async function toolCatalog(chat, sessionId) {
    const tools = foregroundToolCatalog(chat.mode)
    const known = new Set(tools.map(tool => tool.name))
    let extra
    try { extra = await extraTools(sessionId) } catch { extra = [] }
    for (const tool of Array.isArray(extra) ? extra : []) {
      if (!tool || typeof tool.name !== 'string' || known.has(tool.name)) continue
      known.add(tool.name)
      tools.push({ name: tool.name, label: tool.label || tool.name,
        description: tool.description || '插件注册的前台工具。', source: 'plugin' })
    }
    return tools
  }
  async function read(sessionId) {
    const chat = requirePlay(await readConfig(String(sessionId || '')))
    return { ...present(chat), worldbookStrategies: await worldbookStrategies.list(), foregroundTools: await toolCatalog(chat, String(sessionId || '')), mvuCard: chat.mvu?.enabled === true && chat.mvu.owner === 'official', modelCatalog: await modelCatalog() }
  }
  async function checkModel(value, label) {
    const selection = normalizeBackgroundModel(value)
    if (value !== null && !selection) throw new Error(label + '配置无效')
    if (!selection) return
    const catalog = await modelCatalog()
    if (!catalog.some(group => group.provider === selection.provider && group.models.some(model => model.id === selection.model))) throw new Error('所选' + label + '不可用')
    const reasoning = await modelReasoning(selection)
    if (selection.reasoningEffort && !reasoning?.efforts?.some(effort => effort.id === selection.reasoningEffort)) throw new Error('所选推理强度不可用')
  }
  async function save(args = {}) {
    const sessionId = String(args.sessionId || '')
    const chat = requirePlay(await readChat(sessionId))
    if (Object.hasOwn(args, 'worldbookStrategy') && args.worldbookStrategy !== 'legacy' && !await worldbookStrategies.has(args.worldbookStrategy)) throw new Error('世界书策略不可用')
    if (Object.hasOwn(args, 'backgroundModel')) await checkModel(args.backgroundModel, '后台模型')
    const saved = await updateChat(chat.id, current => patchConversationBackground(current, args), { source: 'background-model.switch-conversation' })
    return present(saved)
  }
  return Object.freeze({ read, save })
}
