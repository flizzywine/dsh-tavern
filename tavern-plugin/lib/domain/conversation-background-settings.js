import { patchConversationBackground } from './conversation-background.js'
import { normalizeBackgroundModel } from './background-model-selection.js'
import { SETTINGS_BOUND_STORY_TOOLS, foregroundToolCatalog, normalizeDisabledForegroundTools } from './foreground-tools.js'
import { nativeNetworkCapability } from './network-tools.js'
import { STORY_GENERATE_TOOL_NAME } from './story-tool-submission.js'
import { normalizeConfiguredBackgroundTasks } from './tavern-settings.js'

/** Validate model choices, patch only current configuration and trigger newly enabled work. */
export function createConversationBackgroundSettings({ readConfig, readChat, updateChat, modelCatalog, modelReasoning,
  isPlayMode, expandedCandidates = chat => chat.candidateTabs === true, extraTools = async () => [],
  hasNativeTool = () => false, toolNetworkFor = () => undefined, bodyGenerationToolAvailable = () => false,
  presentExtras = () => ({}), readExtras = async () => ({}), validatePatch = async () => {} }) {
  function requirePlay(chat) {
    if (!chat || !isPlayMode(chat.mode)) throw new Error('请先打开游玩会话')
    return chat
  }
  async function present(chat) {
    return { ...presentExtras(chat), backgroundModel: chat.backgroundModelSelection || null,
      backgroundTasks: normalizeConfiguredBackgroundTasks(chat.backgroundTasks), webSearchEnabled: chat.webSearchEnabled === true,
      candidateTabs: await expandedCandidates(chat),
      disabledForegroundTools: normalizeDisabledForegroundTools(chat.disabledForegroundTools) }
  }
  async function toolCatalog(chat, sessionId) {
    const networkEnabled = chat.webSearchEnabled === true
    const builtins = foregroundToolCatalog(chat.mode)
    const known = new Set(builtins.map(tool => tool.name))
    const showBodyGeneration = known.has(STORY_GENERATE_TOOL_NAME) && await bodyGenerationToolAvailable(sessionId)
    const tools = builtins.filter(({ name }) => {
      if (name === STORY_GENERATE_TOOL_NAME) return showBodyGeneration
      return !nativeNetworkCapability(name) || (networkEnabled && hasNativeTool(name, sessionId))
    })
    let extra
    try { extra = await extraTools(sessionId) } catch { extra = [] }
    for (const tool of Array.isArray(extra) ? extra : []) {
      if (!tool || typeof tool.name !== 'string' || known.has(tool.name) || SETTINGS_BOUND_STORY_TOOLS.has(tool.name)) continue
      if (!networkEnabled && toolNetworkFor(tool.name)) continue
      known.add(tool.name)
      tools.push({ name: tool.name, label: tool.label || tool.name,
        description: tool.description || '插件注册的前台工具。', source: 'plugin' })
    }
    return tools
  }
  async function read(sessionId) {
    const chat = requirePlay(await readConfig(String(sessionId || '')))
    return { ...await present(chat), ...await readExtras(chat), foregroundTools: await toolCatalog(chat, String(sessionId || '')), mvuCard: chat.mvu?.enabled === true && chat.mvu.owner === 'official', modelCatalog: await modelCatalog() }
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
    await validatePatch(args, chat)
    if (Object.hasOwn(args, 'backgroundModel')) await checkModel(args.backgroundModel, '后台模型')
    const saved = await updateChat(chat.id, current => patchConversationBackground(current, args), { source: 'background-model.switch-conversation' })
    return { ...await present(saved), ...(Object.hasOwn(args, 'webSearchEnabled') ? { foregroundTools: await toolCatalog(saved, sessionId) } : {}) }
  }
  return Object.freeze({ read, save })
}
