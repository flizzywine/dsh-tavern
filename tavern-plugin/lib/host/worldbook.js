import { createForegroundWorldbook } from '../domain/foreground-worldbook.js'
import { createPlayWorldBook } from '../domain/play-world-book.js'
import { completedCompactionEpoch, sessionEvents } from '../domain/session-events.js'
import { scriptPromptScanText } from '../domain/tavern-script-prompts.js'
import { createWorldbookFiles } from '../domain/worldbook-files.js'
import { appendWorldbookSkillChanges } from '../domain/worldbook-skill-changes.js'
import { installWorldbookSkillRead, nativeWorldbookReadAvailable } from '../domain/worldbook-skill-read.js'
import { resolveWorldbookSkillChat } from '../domain/worldbook-skill-scope.js'
import { createWorldbookStrategies } from '../domain/worldbook-strategies.js'
import { recentWorldbookLookups } from '../domain/worldbook-title-hints.js'
import { projectVirtualWorldbookPrefix } from '../domain/worldbook-virtual-state.js'
import { registerWorldbookFileTools } from '../tools/worldbook-files.js'

export function installWorldbookHost(ctx, {
  directory, worldBooks, readChat, readChatCard, getAgent, flushSession, getBackground,
  projectCapabilities, templates, poolEntries, cardBubbles, pluginScanTexts, logger = console
}) {
  const { playWorldBook, worldBookScanDepth, mvuUpdateRules } = createPlayWorldBook({
    worldBooks, readChatCard, poolEntries, cardBubbles, readOnlyTemplateRuntime: templates.readOnlyRuntime,
    globalVariables: templates.globalVariables
  })
  const project = createForegroundWorldbook({
    async bound(_cardPath, card, chat, { purpose, userText }) {
      const book = await playWorldBook(chat, card)
      return purpose === 'generation' ? projectCapabilities(chat, book, { userText }) : book
    },
    runtime: templates.runtime,
    globalVariables: templates.globalVariables,
    templateSettings: templates.settings,
    async scanText(chat) {
      const extras = await pluginScanTexts({ gameId: chat.sessionId }).catch(() => [])
      return [scriptPromptScanText(chat), ...extras].filter(Boolean).join('\n')
    }
  })
  ctx.effect(() => () => project.dispose())
  const strategies = createWorldbookStrategies({ nativeSkills: project })
  const bindingFor = agent => resolveWorldbookSkillChat(agent, { background: getBackground(), readChat })
  const files = createWorldbookFiles({
    directory,
    resourcesAvailable: scope => nativeWorldbookReadAvailable(ctx.get('tools'), scope),
    async load(agent) {
      const binding = await bindingFor(agent)
      if (!binding) return null
      const { chat } = binding
      try {
        const card = await readChatCard(chat)
        return { ...binding, card, worldBook: await playWorldBook(chat, card) }
      } catch (error) {
        logger.warn('dsh-tavern: 本局世界书文件不可用:', String(error?.message ?? error ?? ''))
        return null
      }
    }
  })

  const tools = ctx.get('tools')
  if (tools !== undefined) registerWorldbookFileTools(tools, files)
  installWorldbookSkillRead(ctx, files, {
    async virtualOnly(agent) {
      // Background read stays limited to worldbook files even after its lease ends.
      return getBackground().owns(agent?.session?.id) || Boolean(await bindingFor(agent))
    }
  })
  // Observe source changes before each step. Tools also revalidate each access.
  ctx.on('agent/pre-step', async (payload, next) => {
    const { agent, signal } = payload
    await files.refresh(agent, { signal })
    const snapshot = files.changeSnapshot(agent)
    if (snapshot && (snapshot.entries.length || sessionEvents(agent.session).some(event => event.data?.source?.worldbookSkills))) {
      if (appendWorldbookSkillChanges(payload, snapshot)) await flushSession(agent.session)
    }
    return next()
  }, { prepend: true })

  async function projectForeground(input) {
    const agent = input.purpose === 'history-import' ? null : getAgent(input.chat.sessionId)
    const lookups = recentWorldbookLookups(agent?.session, input.chat.messages)
    return strategies.project({ ...input, worldbookEpoch: completedCompactionEpoch(agent?.session),
      recentlyReadRefs: files.refsForLookups(agent, lookups) })
  }

  async function projectPrefix(chat, card, { foreground = false, ...options } = {}) {
    let book
    try {
      book = await playWorldBook(chat, card)
      if (foreground) book = await projectCapabilities(chat, book)
    } catch (error) {
      logger.warn('dsh-tavern: 动态世界书读取失败，已跳过:', String(error?.message ?? error ?? ''))
      return { context: '', refs: [], diagnostics: [{ kind: 'worldbook-template', code: 'worldbook-read-failed' }] }
    }
    if (!book?.view) return { context: '', refs: [], diagnostics: [] }
    return projectVirtualWorldbookPrefix(book, chat, options)
  }

  return {
    read: playWorldBook, scanDepth: worldBookScanDepth, mvuRules: mvuUpdateRules,
    projectForeground, projectPrefix, registerStrategy: strategies.register, files
  }
}
