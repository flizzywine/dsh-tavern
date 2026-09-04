import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const initializationSource = await readFile(new URL('../tavern-plugin/lib/domain/conversation-initialization.js', import.meta.url), 'utf8')
const snapshotsSource = await readFile(new URL('../tavern-plugin/lib/domain/play-card-snapshots.js', import.meta.url), 'utf8')
const backgroundTaskSource = await readFile(new URL('../tavern-plugin/lib/background-agent-task.js', import.meta.url), 'utf8')
const backgroundSessionsSource = await readFile(new URL('../tavern-plugin/lib/background-agent-sessions.js', import.meta.url), 'utf8')
const characterDesignDocumentSource = await readFile(new URL('../tavern-plugin/lib/domain/character-design-document.js', import.meta.url), 'utf8')
const runtimePresetLifecycleSource = await readFile(new URL('../tavern-plugin/lib/domain/runtime-preset-lifecycle.js', import.meta.url), 'utf8')
const orchestratorSource = await readFile(new URL('../tavern-plugin/lib/domain/turn-orchestration.js', import.meta.url), 'utf8')
const orchestrationStrategiesSource = await readFile(new URL('../tavern-plugin/lib/domain/foreground-orchestration-strategies.js', import.meta.url), 'utf8')
const plannerSource = await readFile(new URL('../tavern-plugin/lib/domain/context-planner.js', import.meta.url), 'utf8')
const tavernPresetSource = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')
const backgroundPresetSource = await readFile(new URL('../presets/tavern-background/agent.cordis.yml', import.meta.url), 'utf8').catch(() => '')
const profileSource = await readFile(new URL('../package.json', import.meta.url), 'utf8')
const profilePatchSource = await readFile(new URL('../tavern-plugin/cordis.patch.yml', import.meta.url), 'utf8')
const advancedSkillSource = await readFile(new URL('../presets/tavern/skills/tavern-advanced-capabilities/SKILL.md', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('模型选择只读取当前会话和 DSH 默认值', () => {
  const selection = between(serverSource, 'function modelSelection', 'async function callModel')
  assert.doesNotMatch(selection, /getSettings|updateSettings|settings\.json|settings\.provider|settings\.model/)
  assert.match(serverSource, /当前会话的模型选择器/)
})

test('卡片工作台使用结构化卡片修改工具，不再传递 JSON 字符串', () => {
  assert.doesNotMatch(serverSource, /draftPatch/)
  assert.doesNotMatch(serverSource, /cardPatch|worldBookPatch/)
  assert.match(serverSource, /name: 'tavern_update_card'/)
  assert.match(serverSource, /name: 'tavern_restore_card'/)
  assert.match(serverSource, /fields: \{/)
  const updateCardTool = between(serverSource, "name: 'tavern_update_card'", "name: 'tavern_restore_card'")
  assert.doesNotMatch(updateCardTool, /worldBook: \{/)
  assert.match(serverSource, /name: 'tavern_update_worldbook'/)
})

test('世界书工具统一使用 entry 编号，当前人物卡可省略 path', () => {
  const reader = between(serverSource, "name: 'tavern_read_worldbook'", "name: 'tavern_update_worldbook'")
  const updater = between(serverSource, "name: 'tavern_update_worldbook'", "name: 'tavern_read_preset'")

  assert.match(reader, /例如 entry:0/)
  assert.doesNotMatch(reader, /wb-0/)
  assert.doesNotMatch(updater, /\n        path: \{ type: 'string', required: true/)
  assert.match(updater, /省略 path 时修改当前人物卡绑定的世界书/)
})

test('卡片工作台挂载只提供发现上下文，不限制按合法路径访问资源', () => {
  const cardReader = between(serverSource, "name: 'tavern_read_card'", "name: 'tavern_read_play_chat'")
  const scriptReader = between(serverSource, "name: 'tavern_read_script'", "name: 'tavern_read_worldbook'")
  const worldBookTools = between(serverSource, "name: 'tavern_read_worldbook'", "name: 'tavern_read_preset'")
  const presetTools = between(serverSource, "name: 'tavern_read_preset'", "name: 'tavern_update_card'")

  for (const source of [cardReader, scriptReader, worldBookTools, presetTools]) {
    assert.doesNotMatch(source, /mountedResource|尚未挂载到当前对话/)
  }
})

test('模型工具只保留按需读取和明确修改', () => {
  assert.doesNotMatch(serverSource, /name: 'tavern_session'|action=context|action=commit|assistantText.*description/)
  assert.match(serverSource, /name: 'tavern_read_script'/)
  assert.match(serverSource, /name: 'tavern_read_card'/)
  assert.doesNotMatch(serverSource, /name: 'tavern_read_source'/)
  assert.match(serverSource, /name: 'tavern_read_worldbook'/)
  assert.match(serverSource, /name: 'tavern_update_card'/)
  assert.doesNotMatch(serverSource, /additionalProperties: true \},\s*render/)
})

test('原版恢复工具只操作当前人物卡并要求固定确认文本', () => {
  const restoreTool = between(serverSource, "name: 'tavern_restore_card'", "output:")

  assert.match(restoreTool, /confirmation:/)
  assert.match(restoreTool, /enum: \['确认从原版恢复'\]/)
  assert.doesNotMatch(restoreTool, /path:/)
  assert.match(serverSource, /restoreCurrentCard\(sessionId\)/)
  assert.match(serverSource, /turnOrchestrator\.discard/)
})

test('卡片 Agent 以极简模式工具为底座，游玩 Agent 不暴露文件或 Skill 工具', () => {
  assert.match(profileSource, /"@deepseek-ai\/dsh-base"/)
  assert.doesNotMatch(tavernPresetSource, /dsh-tool-bash-persistent|dsh-tool-pwsh-persistent|dsh-terminal-bash|timeoutMs: 300000/)
  assert.doesNotMatch(tavernPresetSource, /id: (?:bash|pwsh)-sandbox/)
  assert.match(profilePatchSource, /id: bash-sandbox[\s\S]*?timeoutMs: 600000[\s\S]*?maxTimeoutMs: 600000/)
  assert.match(profilePatchSource, /id: pwsh-sandbox[\s\S]*?timeoutMs: 600000[\s\S]*?maxTimeoutMs: 600000/)
  assert.match(profilePatchSource, /id: tool-bash[\s\S]*?disabled: !!js process\.platform === 'win32'/)
  assert.match(profilePatchSource, /id: tool-pwsh[\s\S]*?disabled: !!js process\.platform !== 'win32'/)
  assert.match(profilePatchSource, /id: tool-fs[\s\S]*?disabled: false/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-tool-str-replace-editor/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-skill-filesystem/)
  assert.match(tavernPresetSource, /includeDefaultRoots: false/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-tool-skill/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-tool-cordis/)
  assert.match(tavernPresetSource, /text: ''/)
  assert.doesNotMatch(tavernPresetSource, /complete: true/)
  assert.match(serverSource, /modePrompt: function \(\) \{ return runtimePrompt\('card-mode'\) \}/)
  assert.doesNotMatch(serverSource, /runtimePrompt\('play-mode'\)/)
  assert.match(serverSource, /workspaceContext: resourceWorkspaceContext/)
  assert.doesNotMatch(orchestrationStrategiesSource, /section\.name === 'tool:cordis'/)
  assert.match(orchestrationStrategiesSource, /name: 'tavern:resource-workspace'/)
  assert.match(advancedSkillSource, /Cordis 动态插件/)
  assert.match(advancedSkillSource, /tools\.cordis\.yml/)
  assert.match(orchestratorSource, /if \(mode === 'card'\) return \[shellToolName, \.\.\.dshFileToolNames, 'skill', 'tavern_save_skill', \.\.\.cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save_draft', 'tavern_user_profile_confirm', 'tavern_read_card'/)
  assert.doesNotMatch(orchestratorSource, /mode === 'revision'|mode === 'extract'/)
  assert.doesNotMatch(orchestratorSource, /if \(mode === 'script'\) return \[[^\]]*'bash'/)
	assert.match(serverSource, /controlledToolNames = new Set\(\['bash', 'pwsh', \.\.\.dshFileToolNames, 'skill', 'web_search', 'tavern_save_skill', \.\.\.cordisToolNames, 'tavern_user_profile_read'/)
  assert.match(serverSource, /name: 'tavern_save_skill'/)
  assert.doesNotMatch(serverSource, /name: 'tavern_bind_script'/)
})

test('酒馆模式启用 DSH 原生上下文压缩和 /compact 命令', () => {
  assert.match(tavernPresetSource, /id: compaction[\s\S]*?isolate:[\s\S]*?compaction: true[\s\S]*?toolResultPruner: true/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-compaction-basic/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-command-compact/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-compaction-tool-result-pruner/)
})

test('后台压缩在 Agent 作用域挂载 DSH compaction，不阻塞 Tavern Host 启动', () => {
  const tavernEntry = between(profilePatchSource, '- id: dsh-tavern', '- agentPresets') + '- agentPresets'
  assert.doesNotMatch(tavernEntry, /- compaction/)
  assert.match(backgroundPresetSource, /@deepseek-ai\/dsh-compaction-basic/)
  assert.match(backgroundPresetSource, /@deepseek-ai\/dsh-command-compact/)
  assert.match(serverSource, /agentPresets\.mount\(childCtx, 'tavern-background'\)/)
  assert.match(serverSource, /compactAgent: executeBackgroundCompaction/)
  assert.match(backgroundSessionsSource, /agentCtx\.get\('commands'\)/)
  assert.match(backgroundSessionsSource, /commands\.execute\(agent, '\/compact', \[\], signal\)/)
  assert.doesNotMatch(serverSource, /ctx\.get\('compaction'\)/)
})

test('后台最小预设提供原生 Skill 目录与按需加载工具', () => {
  assert.match(backgroundPresetSource, /@deepseek-ai\/dsh-skill-filesystem/)
  assert.match(backgroundPresetSource, /includeDefaultRoots: false/)
  assert.doesNotMatch(backgroundPresetSource, /customSkillDirs/)
  assert.match(backgroundPresetSource, /new URL\('skills\/', baseUrl\)/)
  assert.match(backgroundPresetSource, /@deepseek-ai\/dsh-tool-skill/)
  assert.match(backgroundSessionsSource, /dsh-tavern-background-tools-v4/)
  assert.match(backgroundSessionsSource, /STALE_BACKGROUND_PROVIDERS\.has\(savedDescriptor\.provider\)/)
  assert.match(serverSource, /createCharacterDesignDocumentTools/)
  assert.match(characterDesignDocumentSource, /persisting every valid save immediately/)
  assert.doesNotMatch(serverSource, /task: 'character-design'|request_character_design/)
})

test('候选项通过持久任务信箱提交，同步快照原子携带结果', () => {
  const dispatch = between(serverSource, "case 'syncSession'", "case 'getSessionActivity'")

  assert.match(dispatch, /case 'syncSession'/)
  assert.match(dispatch, /case 'submitTask'/)
  assert.match(serverSource, /result: \{ candidates \}/)
  assert.match(clientSource, /readyCandidatePanel\(props\.sessionId, props\.messageId, taskForMessage\.result\.candidates\)/)
  assert.doesNotMatch(clientSource, /createCandidateGenerationCoordinator/)
  assert.match(clientSource, /查看后台 Agent/)
  assert.doesNotMatch(clientSource, /button\[aria-haspopup="tree"\] \{ display: none !important; \}/)
  assert.match(clientSource, /refreshSubagents\(panel\.sessionId\)/)
  assert.match(clientSource, /openSubagent\(\{ parentSessionId: panel\.sessionId, childSessionId: panel\.traceSessionId, mode: panel\.traceMode \}\)/)
})

test('姿势结算通过短工具参数提交', () => {
  const input = between(serverSource, 'function settleUserText', 'function applySettlement')
  const mvuRules = between(serverSource, 'async function mvuUpdateRules', 'async function prepareNextWorldBookContext')
  const flow = between(serverSource, 'async function runSettlement', 'function queueSettlement')
  const systemPrompt = prompt('posture-settlement')

  assert.match(input, /slice\(-2\)/)
  assert.match(input, /【上一轮结算姿势】/)
  assert.match(input, /projectAgentMessageText/)
  assert.match(mvuRules, /projectAgentContent\(rule/)
  assert.doesNotMatch(input, /m\.sourceText/)
  assert.doesNotMatch(input, /slice\(-4\)/)
  assert.match(systemPrompt, /posture_submit/)
  assert.match(systemPrompt, /位置、姿势、动作/)
  assert.doesNotMatch(flow, /maxTokens:/)
  assert.match(flow, /tools: \[POSTURE_SUBMIT_TOOL, CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL\]/)
  assert.match(flow, /skill 加载 tavern-character-design/)
  assert.match(flow, /characterDesignDocuments\.execute/)
  assert.match(flow, /normalizePostureSubmission/)
  assert.match(flow, /未调用 posture_submit/)
  assert.match(flow, /text\.slice\(0, 200\)/)
  assert.match(flow, /backgroundAgentRunner\.run/)
  assert.match(flow, /task: 'settlement'/)
  assert.match(flow, /persistent: true/)
  assert.match(flow, /backgroundTasks\.begin\(snapshot, 'settlement'\)/)
  assert.match(flow, /storyText: projectAgentMessageText\(mvuTarget\.message/)
  assert.match(flow, /taskRun\.participant\(\{ sessionId: backgroundSessionId, boundary: backgroundBoundary \}\)/)
})

test('达到输出 token 上限时不把截断内容当作成功', () => {
  const call = between(serverSource, 'async function callModel', 'const contextPlanner')

  assert.match(call, /finish\.kind === 'max-tokens'/)
  assert.match(call, /模型输出达到 token 上限/)
})

test('后台 Agent 不进入前台正文上下文注入和工具过滤', () => {
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.match(lifecycle, /backgroundAgentRunner\.owns\(sessionId\)/)
  assert.match(lifecycle, /if \(backgroundAgentRunner\.owns\(sessionId\)\) return next\(\)/)
  assert.match(lifecycle, /if \(backgroundAgentRunner\.owns\(sessionId\)\) return/)
  assert.match(lifecycle, /if \(backgroundAgentRunner\.owns\(agent\.session\.id\)\) return assembly/)
})

test('外部预设作用于前台游玩，后台与卡片 Agent 保持 DSH 原生上下文', () => {
  const startChat = between(initializationSource, 'async function initialize', 'function openingText')
  assert.match(startChat, /const runtimePresetSnapshot = groupOfMode\(chatMode\) === 'play' \? await playPresetSnapshot\(\) : null/)
  assert.match(initializationSource, /presets\.claimPreparedFullSnapshot/)
  assert.match(initializationSource, /prepared === undefined \? await presets\.fullSnapshot\(\) : prepared/)
  assert.match(startChat, /chat\.runtimePresetSnapshot = runtimePresetSnapshot/)
  const resolver = between(serverSource, 'async function resolveChatRuntimePreset', 'function compatibilityWorldBookMatch')
  assert.match(resolver, /const raw = groupOfMode\(chat\.mode\) === 'play' \? await runtimePresets\.fullSnapshot\(\) : null/)
  assert.match(resolver, /chat\.bypassPlanId = ''/)
  assert.doesNotMatch(resolver, /bypassPlans/)
  const backgroundSetup = between(serverSource, 'const backgroundAgentRunner = createBackgroundAgentRunner', 'ctx.effect')
  assert.match(backgroundSetup, /resolveRuntimePresetSnapshot: async function \(input\) \{[\s\S]*return null/)
  assert.doesNotMatch(backgroundSetup, /resolveChatRuntimePreset/)
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')
  assert.match(orchestrationStrategiesSource, /const snapshot = mode === 'story' \|\| mode === 'script' \? await options\.resolvePreset\(input\.chat\) : null/)
  assert.match(orchestrationStrategiesSource, /scope: 'foreground'/)
  assert.match(serverSource, /foregroundFrameSessionAdapter\.append\(input\)/)
  const compatibility = between(serverSource, 'async function compileCompatibilityTurn', '// ---------- DSH 回合生命周期 ----------')
  assert.match(compatibility, /const snapshot = await resolveChatRuntimePreset\(chat\)/)
  assert.match(compatibility, /const preset = await readPreset\(presetPath\)/)
  assert.match(compatibility, /const presetDocument = await readPresetDocument\(presetPath\)/)
  assert.doesNotMatch(compatibility, /bypassPlans/)
  assert.doesNotMatch(compatibility, /并新建对话/)
  assert.match(serverSource, /modelRequestLog\.record\(\{ chat, context: backgroundContext, coordinates, options \}\)/)
  assert.match(lifecycle, /ctx\.on\('agent\/request-error', tavernRetryLimiter\.handle, \{ prepend: true \}\)/)
  assert.match(serverSource, /const activePresetSnapshot = groupOfMode\(chat\.mode\) === 'play' \? await runtimePresets\.fullSnapshot\(\) : null/)
  assert.match(serverSource, /if \(!chat \|\| groupOfMode\(chat\.mode\) !== 'play'\) return \[\]/)
  assert.match(backgroundTaskSource, /resolveRuntimePresetSnapshot/)
  assert.match(backgroundTaskSource, /stageRuntimePresetSnapshot/)
  assert.doesNotMatch(backgroundTaskSource, /runtimePresetPhaseMessages\(snapshot, 'front'/)
  assert.doesNotMatch(backgroundTaskSource, /runtimePresetPhaseMessages\(snapshot, 'back'/)
  assert.match(backgroundTaskSource, /middleMessages\.concat\(decision\.messages\)/)
  assert.doesNotMatch(backgroundTaskSource, /projectBackgroundInput|projectBackgroundOutput/)
  assert.doesNotMatch(serverSource, /boundaryPrompts|resolveProjectedBoundaryPrompt/)
})

test('无玩家输入的开场回合不进入正文结算', () => {
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.match(lifecycle, /const userText = userTextForTurn\(session, payload\.turn\)/)
  assert.match(lifecycle, /if \(userText === ''\) return/)
  assert.match(lifecycle, /userText,\s*assistantText:/)
})

test('游玩 Agent 接收解析后的玩家输入，不接收原始 Tavern 宏代码', () => {
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.match(orchestrationStrategiesSource, /replaceTurnInput\(agentMessages, prepared\.frame\.userInput\.projectedText\)/)
})

test('读取 Session View 不启动后台工作，开场回合由玩家输入边界过滤', () => {
  const sessionView = between(serverSource, 'async function sessionView', 'async function ensureNativeOpening')
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.doesNotMatch(sessionView, /queueSettlement|writeChat|settleStatus/)
  assert.match(lifecycle, /if \(userText === ''\) return/)
})

test('游玩固定选择一个开场白，并用它对齐剧本', () => {
  const startChat = between(initializationSource, 'async function initialize', 'function openingText')
  const appendOpening = between(initializationSource, 'function openingText', 'async function recover')

  assert.match(serverSource, /projectCardOpeningPreviews\(/)
  assert.match(startChat, /resolveCardOpening\(card, openingId\)/)
  assert.match(startChat, /projectOpeningCommit\(openingSourceText/)
  assert.doesNotMatch(startChat, /openingProjection\.presentationOnly.*throw/)
  assert.match(startChat, /const greeting = openingProjection\.sessionText/)
  assert.match(startChat, /chat\.openingText = greeting/)
  assert.doesNotMatch(startChat, /chat\.presentation =/)
  assert.match(startChat, /startAligned\(script, greeting, card\.script_start\)/)
  assert.match(startChat, /sourceText: openingSourceText/)
  assert.match(startChat, /displayText: openingProjection\.displayText/)
  assert.match(appendOpening, /typeof chat\.openingText === 'string'/)
  assert.doesNotMatch(appendOpening, /projectRuntimeReply\(text\)/)
  assert.doesNotMatch(serverSource, /switchOpening|openingViewOf|switchable: !hasStory/)
})

test('新 MVU 对话直接交给固定官方运行时初始化，不再调用旧结算器', () => {
  const startChat = between(initializationSource, 'async function initialize', 'function openingText')
  assert.match(startChat, /owner: 'official'/)
  assert.match(startChat, /runtime: 'magvarupdate'/)
  assert.match(startChat, /variables: openingChoices\.map\(function \(\) \{ return \{\} \}\)/)
  assert.doesNotMatch(startChat, /tavernMvu\.initializeChat|readMvuWorldBookInitialState/)
})

test('人物卡基本信息固定为会话前缀，仅系统和历史后指令逐轮注入', () => {
  const startChat = between(initializationSource, 'async function initialize', 'function openingText')
  const buildSnapshot = between(snapshotsSource, 'async function build', '// A new chat')
  const ensureSnapshot = between(snapshotsSource, 'async function ensure', 'return Object.freeze')
  const systemAssembly = between(serverSource, "ctx.on('system-prompt/assemble'", '// ---------- 模型可选工具 ----------')
  const bodyPlanner = between(plannerSource, "if (input.purpose === 'body')", "if (input.purpose === 'candidate')")

  assert.match(startChat, /await snapshots\.prepare\(chat, card\)/)
  assert.match(buildSnapshot, /worldBook = await worldBooks\.bound\(chat.cardPath, card\)/)
  assert.match(buildSnapshot, /constantWorldBookContext\(\{ worldBook \}\)/)
  assert.match(buildSnapshot, /worldBookLabel: '常驻世界书'/)
  assert.match(ensureSnapshot, /sanitizeAgentProjectionText\(existing\)/)
  assert.match(ensureSnapshot, /cardContextSnapshot: sanitized/)
  assert.match(ensureSnapshot, /await writeChat\(draft, \{ source \}\)/)
  assert.doesNotMatch(orchestrationStrategiesSource, /name: 'tavern:card-snapshot'/)
  assert.doesNotMatch(orchestrationStrategiesSource, /projectSessionStablePrefix/)
  assert.match(startChat + serverSource, /ensureSessionStablePrefix/)
  assert.match(bodyPlanner, /includeDetails: true/)
  assert.match(bodyPlanner, /includeDescription: false/)
  assert.match(bodyPlanner, /includePersonality: false/)
  assert.match(bodyPlanner, /includeScenario: false/)
  assert.match(bodyPlanner, /includeStyleExample: false/)
  assert.match(bodyPlanner, /includeSystemPrompt: true/)
  assert.match(bodyPlanner, /includePostHistory: true/)
  assert.doesNotMatch(bodyPlanner, /hasStoryTurn/)
})

test('游玩回复把 prompt 投影写回 DSH Session，同时保留完整展示投影', () => {
  const lifecycle = between(serverSource, "ctx.on('agent/turn-stopping'", "ctx.on('session/event'")
  const replaceReply = between(serverSource, 'function replaceAssistantReply', '// ---------- DSH 回合生命周期 ----------')

  assert.match(serverSource, /projectReply: projectRuntimeReply/)
  assert.match(lifecycle, /if \(saved\.reply\) replaceAssistantReply\(session, assistant, saved\.reply\.sessionText\)/)
  assert.doesNotMatch(lifecycle, /presentationHtml|\\u00a0/)
  assert.match(replaceReply, /surfaceOp: \{ op: 'replace', start: result\.index, end: result\.index \}/)
})

test('新会话取得可写 Session 后通过 Conversation Registry 原子发布', () => {
  const startChat = between(initializationSource, 'async function initialize', 'function openingText')
  const appendOpening = between(initializationSource, 'function openingText', 'async function recover')

  assert.match(startChat, /const openingTarget = .*native\.wait/)
  assert.ok(startChat.indexOf('native.wait') < startChat.indexOf('await chats.publish(chat)'))
  assert.match(startChat, /await chats\.publish\(chat\)/)
  assert.doesNotMatch(startChat, /linkSession|unlinkSession|writeIndex\(idx\)/)
  assert.match(startChat, /appendNativeOpening\(sessionId, chat, card, openingTarget\)/)
  assert.match(appendOpening, /readyTarget \|\| await native\.wait/)
  assert.match(appendOpening, /await native\.flush\(target\.session\)/)
})
