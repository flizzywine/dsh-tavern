import { promptSection } from './prompt-section.js'
import { scriptForState } from './script-layout.js'
import { projectAgentContent, projectAgentMessageText } from './runtime-content-projection.js'
import { createBackgroundTaskCoordinator } from './background-task-coordinator.js'
import { CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL } from './character-design-document.js'

// Prompt prose source: task-specific additions, unchanged in phase 1.
const TASK_PROMPT_PROSE = Object.freeze({
  p001: "\n\nExtra user requirements:\n",
  p002: "\n\nThe extra requirements don't change the ",
  p003: "script direction, 1-choice count or type rules.",
  p004: "actor grouping, per-tab count, featured combination or global event/scene rules.",
  p005: "\n\nChoice point: story revision ",
  p006: "; latest story turn ",
  p007: ". Continue from the end of the latest story text with its current identities, names, place and time; don't roll renamed or finished plot back to the card's opening.",
  p008: "\nPlayer's name in this session: ",
  p009: " (if the story has clearly renamed them, the latest story wins)."
})


// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  // the background session is persistent, so a repeat request at the same choice point
  // sees its earlier accepted submission; the model must not treat that as already done.
  p001: "Generate the choices by the rules above. This is a new request: submit with candidate_submit_choices now, even if this session already submitted choices before — earlier submissions were for earlier requests and don't count for this one."
})


function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function candidateFailure(stage, message, cause) {
  const detail = str(cause && cause.message || cause).trim()
  const error = new Error(detail === '' ? message : `${message}：${detail}`, cause instanceof Error ? { cause } : undefined)
  error.code = 'CANDIDATE_' + stage.toUpperCase() + '_FAILED'
  error.stage = stage
  return error
}

function messageText(message, card, chat) {
  return projectAgentMessageText(message, {
    charName: str(card && card.name),
    macroState: chat && chat.macroState
  })
}

function parseJsonLenient(text) {
  if (text === undefined || text === null || text === '') return {}
  let source = str(text).trim()
  if (source.startsWith('```')) {
    const newline = source.indexOf('\n')
    if (newline >= 0) source = source.slice(newline + 1)
    if (source.endsWith('```')) source = source.slice(0, -3)
    source = source.trim()
  }
  try {
    const value = JSON.parse(source)
    if (value !== null && typeof value === 'object') return value
  } catch (error) {}
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(source.slice(start, end + 1))
      if (value !== null && typeof value === 'object') return value
    } catch (error) {}
  }
  return {}
}

function choiceType(value) {
  const type = str(value).trim().toLowerCase()
  if (type === 'action' || type === '人物行为' || type === '行动') return 'action'
  if (type === 'event' || type === '突发事件' || type === '突发互动' || type === '全局事件' || type === '插曲') return 'event'
  if (type === 'scene' || type === 'scene2' || type === 'newscene' || type === '场景' || type === '新场景' || type === '场景变化' || type === '场景切换') return 'scene'
  if (type === 'featured' || type === 'combo' || type === '精选' || type === '组合') return 'featured'
  return null
}

function projectCandidateIdentityMacros(value, card, chat) {
  const userName = str(chat && chat.macroState && chat.macroState.userName) || '你'
  const charName = str(card && card.name)
  return str(value).replace(/\{\{\s*(user|char)\s*\}\}/gi, function (_match, name) {
    return String(name).toLowerCase() === 'user' ? userName : charName
  })
}

// Some models double-escape tool arguments: literal "\\u7a97" text becomes the character.
export function decodeLiteralUnicodeEscapes(value) {
  const text = str(value)
  if (!/\\u[0-9a-fA-F]{4}/.test(text)) return text
  return text.replace(/(?:\\u[0-9a-fA-F]{4})+/g, run => {
    try {
      const decoded = JSON.parse('"' + run + '"')
      return decoded.isWellFormed() ? decoded : run
    } catch { return run }
  })
}

const MAX_ACTOR_GROUPS = 4
const MAX_ACTIONS_PER_ACTOR = 3
const MAX_FEATURED_CHOICES = 4
const MAX_SAVED_STORY_CHOICES = 20

function cleanCandidateText(value, card, chat) {
  return decodeLiteralUnicodeEscapes(projectCandidateIdentityMacros(value, card, chat)).trim()
}

function cleanRouteTag(value, card, chat) {
  return cleanCandidateText(value, card, chat).replace(/^[【〔\[]+|[】〕\]]+$/g, '').slice(0, 12).trim()
}

function validatedChoices(source, scriptMode, logger) {
  const choices = []
  for (const item of Array.isArray(source) ? source : []) {
    if (item === null || typeof item !== 'object') continue
    const rawType = choiceType(item.type)
    const type = scriptMode && rawType === 'event' ? 'action' : rawType
    const text = decodeLiteralUnicodeEscapes(item.text).trim()
    if (type === null || text === '' || choices.some(function (choice) { return choice.text === text })) continue
    const actor = type === 'action' ? decodeLiteralUnicodeEscapes(item.actor).trim() : ''
    const routeTag = decodeLiteralUnicodeEscapes(item.routeTag).replace(/^[【〔\[]+|[】〕\]]+$/g, '').slice(0, 12).trim()
    choices.push({
      type,
      ...(actor !== '' ? { actor } : {}),
      ...(routeTag !== '' ? { routeTag } : {}),
      text
    })
  }
  if (scriptMode) {
    if (choices.length === 0) throw new Error('模型没有返回至少 1 个有效候选项')
    if (choices.length > 1 && logger && typeof logger.warn === 'function') {
      logger.warn(`dsh-tavern: 模型候选项返回 ${choices.length} 个剧本候选，已裁剪为 1 个。`)
    }
    return choices.slice(0, 1).map(function (item) {
      return { type: item.type, ...(item.routeTag ? { routeTag: item.routeTag } : {}), text: item.text }
    })
  }
  const actions = choices.filter(function (choice) { return choice.type === 'action' })
  const scenes = choices.filter(function (choice) { return choice.type === 'scene' })
  if (actions.length < 4 || scenes.length < 1) {
    throw new Error('模型没有返回至少 4 个行动候选和 1 个场景候选')
  }
  if ((actions.length > 4 || scenes.length > 1) && logger && typeof logger.warn === 'function') {
    logger.warn(`dsh-tavern: 模型候选项返回 ${actions.length} 个行动候选和 ${scenes.length} 个场景候选，已裁剪为 4 + 1。`)
  }
  return actions.slice(0, 4).concat(scenes.slice(0, 1))
}

function parseSubmittedChoices(args, { card, chat, scriptMode = false, lenientGlobal = false, logger } = {}) {
  const payload = args !== null && typeof args === 'object' ? args : {}
  if (Array.isArray(payload.actors) && payload.actors.length > 0) {
    const seenTexts = new Set()
    const actorMap = new Map()
    for (const entry of payload.actors) {
      if (entry === null || typeof entry !== 'object') continue
      const name = cleanCandidateText(entry.name || entry.actor, card, chat)
      if (name === '') continue
      if (!actorMap.has(name)) {
        if (actorMap.size >= MAX_ACTOR_GROUPS) {
          if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 模型候选项超过 ${MAX_ACTOR_GROUPS} 个角色分组，已忽略多余分组 ${name}。`)
          continue
        }
        actorMap.set(name, [])
      }
      const list = actorMap.get(name)
      const rawActions = Array.isArray(entry.actions) ? entry.actions : []
      const rawRouteTags = Array.isArray(entry.routeTags) ? entry.routeTags : []
      for (let actionIdx = 0; actionIdx < rawActions.length; actionIdx++) {
        const rawAction = rawActions[actionIdx]
        if (list.length >= MAX_ACTIONS_PER_ACTOR) break
        const text = cleanCandidateText(typeof rawAction === 'string' ? rawAction : rawAction?.text, card, chat)
        if (text === '' || seenTexts.has(text)) continue
        const routeTag = cleanRouteTag(typeof rawAction === 'object' ? rawAction?.routeTag : rawRouteTags[actionIdx], card, chat)
        seenTexts.add(text)
        list.push(routeTag ? { text, routeTag } : { text })
      }
    }
    const events = []
    const scenes = []
    function pushGlobal(kind, rawValue, rawTag) {
      const text = cleanCandidateText(rawValue, card, chat)
      if (text === '' || seenTexts.has(text)) return
      const routeTag = cleanRouteTag(rawTag, card, chat)
      seenTexts.add(text)
      const entry = routeTag ? { text, routeTag } : { text }
      if (kind === 'scene') scenes.push(entry)
      else events.push(entry)
    }
    if (payload.event !== undefined) pushGlobal('event', typeof payload.event === 'string' ? payload.event : payload.event?.text, payload.eventRouteTag ?? payload.event?.routeTag)
    if (payload.scene !== undefined) pushGlobal('scene', typeof payload.scene === 'string' ? payload.scene : payload.scene?.text, payload.sceneRouteTag ?? payload.scene?.routeTag)
    if (Array.isArray(payload.global)) {
      for (const item of payload.global) {
        if (typeof item === 'string') pushGlobal(events.length === 0 ? 'event' : 'scene', item)
        else if (item && typeof item === 'object') {
          const kind = choiceType(item.type) === 'scene' ? 'scene' : 'event'
          pushGlobal(kind, item.text, item.routeTag)
        }
      }
    }
    if (scriptMode) {
      const flat = []
      for (const actions of actorMap.values()) {
        for (const item of actions) flat.push({ type: 'action', ...item })
      }
      for (const item of events) flat.push({ type: 'action', ...item })
      for (const item of scenes) flat.push({ type: 'scene', ...item })
      return validatedChoices(flat, true, logger)
    }
    const groups = []
    for (const [name, actions] of actorMap.entries()) {
      if (actions.length > 0) groups.push({ name, actions })
    }
    const featuredChoices = []
    const rawFeatured = Array.isArray(payload.featured) ? payload.featured : []
    for (const entry of rawFeatured) {
      if (featuredChoices.length >= MAX_FEATURED_CHOICES) break
      if (entry === null || typeof entry !== 'object') continue
      const text = cleanCandidateText(entry.text, card, chat)
      if (text === '' || seenTexts.has(text)) continue
      const rawActors = Array.isArray(entry.actors)
        ? entry.actors
        : (Array.isArray(entry.names) ? entry.names : (entry.actor ? [entry.actor] : []))
      const featuredActors = []
      let hasEvent = entry.event === true || entry.hasEvent === true
      let hasScene = entry.scene === true || entry.hasScene === true
      for (const rawName of rawActors) {
        const tag = cleanCandidateText(rawName, card, chat)
        if (tag === '') continue
        const tagType = choiceType(tag)
        if (tagType === 'event') { hasEvent = true; continue }
        if (tagType === 'scene') { hasScene = true; continue }
        if (!featuredActors.includes(tag) && featuredActors.length < MAX_ACTOR_GROUPS) featuredActors.push(tag)
      }
      const elementCount = featuredActors.length + (hasEvent ? 1 : 0) + (hasScene ? 1 : 0)
      if (featuredActors.length === 0 || elementCount < 2) continue
      const featuredRouteTag = cleanRouteTag(entry.routeTag, card, chat)
      seenTexts.add(text)
      featuredChoices.push({
        type: 'featured',
        actors: featuredActors,
        ...(hasEvent ? { hasEvent: true } : {}),
        ...(hasScene ? { hasScene: true } : {}),
        ...(featuredRouteTag ? { routeTag: featuredRouteTag } : {}),
        text
      })
    }
    const totalActorActions = groups.reduce(function (sum, group) { return sum + group.actions.length }, 0)
    if (groups.length === 0 || totalActorActions < 3) {
      throw new Error('模型没有返回至少 3 条有效角色行动候选（actors）')
    }
    if (!lenientGlobal && groups.some(function (group) { return group.actions.length < 2 })) {
      throw new Error('每个在场角色分组（actors）至少需要提供 2 条行动候选')
    }
    if (!lenientGlobal && (events.length < 1 || scenes.length < 1)) {
      throw new Error('自由故事需要同时提供 1 条突发互动/事件（event）和 1 条场景切换（scene）')
    }
    if (!lenientGlobal && groups.length >= 2 && featuredChoices.length < 2) {
      throw new Error('多角色场景下 featured 至少需要提供 2 条结合多个角色或事件/场景的精选组合')
    }
    if (lenientGlobal && events.length < 1 && scenes.length < 1) {
      throw new Error('模型没有返回有效的全局候选项（event 或 scene）')
    }
    const choices = []
    for (const group of groups) {
      for (const item of group.actions) choices.push({ type: 'action', actor: group.name, ...item })
    }
    if (events.length > 0) choices.push({ type: 'event', ...events[0] })
    if (scenes.length > 0) choices.push({ type: 'scene', ...scenes[0] })
    choices.push(...featuredChoices)
    return choices
  }

  const rawActions = Array.isArray(payload.actions) ? payload.actions : []
  const actions = rawActions.map(function (item) {
    const text = typeof item === 'string' ? item : str(item && item.text)
    return cleanCandidateText(text, card, chat)
  }).filter(Boolean)
  const eventText = typeof payload.event === 'string' ? payload.event : str(payload.event && payload.event.text)
  const event = cleanCandidateText(eventText, card, chat)
  const sceneText = typeof payload.scene === 'string' ? payload.scene : str(payload.scene && payload.scene.text)
  const scene = cleanCandidateText(sceneText, card, chat)
  const items = actions.map(function (text) { return { type: 'action', text } })
  if (scriptMode && event !== '') items.push({ type: 'action', text: event })
  if (scene !== '') items.push({ type: 'scene', text: scene })
  return validatedChoices(items, scriptMode, logger)
}

function buildMessages(chat, card, selection, now, limit = 3) {
  const source = [], history=chat.messages || []
  for(let index=history.length-1;index>=0 && source.length<Math.max(1,Number(limit)||3);index--){
    const message=history[index]
    if(message?.role!=='assistant')continue
    const text=messageText(message,card,chat)
    if(text!=='')source.unshift({message,text})
  }
  const messages = []
  for (let index = 0; index < source.length; index++) {
    const item = source[index]
    messages.push({
      id: 'm' + index + '-' + now().toString(36),
      role: 'assistant',
      content: [{ type: 'text', text: item.text }],
      source: { kind: 'model', provider: selection.provider, model: selection.model }
    })
  }
  return messages
}

export const FOREGROUND_CHOICES_OPEN_TAG = '<story_choices>'
export const FOREGROUND_CHOICES_CLOSE_TAG = '</story_choices>'

export const FOREGROUND_CANDIDATES_PROMPT = [
  '<foreground_story_candidates>',
  'After finishing the story prose for this turn, append a `<story_choices>` block at the very end on a new line (inside `submit_story` `content` if using tool submission, or at the end of your text reply):',
  '<story_choices>',
  '{"actors":[{"name":"...","actions":["...","...","..."]},{"name":"...","actions":["...","...","..."]}],"event":"...","scene":"...","featured":[{"actors":["...","..."],"event":false,"scene":false,"text":"..."}]}',
  '</story_choices>',
  'Requirements for the choices (~40 characters each for individual items, ~50–70 characters for featured combinations, in the story\'s language):',
  '- `actors` lists the active characters in the scene, placing the current focal counterpart / spotlight partner FIRST:',
  '  - Follow the story\'s narrative perspective: if a first-person player avatar (`我`) is in the scene, include `"我"` with 3 actions; if the story is third-person or has no `"我"`, use actual character names and do not invent `"我"`.',
  '  - Include up to 3 active non-player characters currently in the scene or poised to intervene: 3 actions when 1 other character is present, or 2 actions each when 2–3 other characters are present (in pure third-person ensemble prose without a single player avatar, list 1–3 main present characters: 3 actions each for 1–2 characters, or 3 for the focal character and 2 each for the others when 3 characters are present).',
  '  - State the acting character clearly in every action and span distinct angles (escalate momentum, shift initiative or posture, verbal/emotional tension, physical or environmental detail) with no overlap.',
  '- `event` holds 1 sudden interaction, external interruption, or multi-party situation shift within the current scene.',
  '- `scene` holds 1 scene-change direction transitioning to a new time, location, or incoming situation.',
  '- `featured` holds 2–4 curated ensemble combinations for the default Featured tab: pick compatible intentions across different `actors` (and optionally `event` or `scene`), then blend and smooth them into ONE concise, cohesive, causal staging line instead of mechanically concatenating separate lines; combine at least 2 elements per item (2–3 characters from `actors`, or 1+ character with `event: true` or `scene: true`; omit or keep fewer only when a single character is completely alone).',
  '- When `<plot_compass>` is active in context, you may optionally include `routeTags` (array aligned with `actions` on an actor group) and `routeTag` (on `featured` items) with the short 2–6 char route label.',
  '- Write as concrete director staging instructions matching the current tone and rating (both SFW and explicit NSFW are fully supported). Do not write anything after `</story_choices>`.',
  '</foreground_story_candidates>'
].join('\n')

export function foregroundCandidatePrompt(chat) {
  if ((chat?.mode || 'story') !== 'story' || chat?.backgroundTasks?.foregroundCandidates !== true) return ''
  return FOREGROUND_CANDIDATES_PROMPT
}

// What may follow the real choices block: whitespace, comments, and the card
// protocol's own closing/self-closing tags (`<story_done/></story_after_format></story_plot>`), never prose.
const CHOICES_TAIL_RE = /^(?:\s*(?:<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:.-]*(?:\s[^>]*)?\/?>))*\s*$/

/**
 * Extract the trailing `<story_choices>...</story_choices>` block of a foreground reply.
 * Returns `{ proseText, choices, hadTag }`, where `choices` is either a validated
 * choice array or `null` if no valid block was present. The trailing block (complete
 * or truncated at max-tokens) is stripped from `proseText`.
 *
 * Only the last tag can be the block. A story that explains its own protocol quotes
 * the tag in the prose (`…附上 \`<story_choices>{"actions":…}</story_choices>\``), and a
 * first-match search cut the round at that quote: the save then kept only the planning
 * text before it as the body, and the round showed an empty story.
 */
export function extractForegroundStoryChoices(rawText, { card, chat, logger } = {}) {
  const source = str(rawText)
  const lower = source.toLowerCase()
  const open = lower.lastIndexOf(FOREGROUND_CHOICES_OPEN_TAG)
  if (open < 0) return { proseText: source, choices: null, hadTag: false }
  const afterOpen = open + FOREGROUND_CHOICES_OPEN_TAG.length
  const close = lower.indexOf(FOREGROUND_CHOICES_CLOSE_TAG, afterOpen)
  // Closed and then followed by prose: that was a quote inside the story, not the block.
  const tail = close >= 0 ? source.slice(close + FOREGROUND_CHOICES_CLOSE_TAG.length) : ''
  if (close >= 0 && !CHOICES_TAIL_RE.test(tail)) return { proseText: source, choices: null, hadTag: false }
  const proseText = source.slice(0, open).trimEnd()
  const payload = str(source.slice(afterOpen, close >= 0 ? close : source.length)).trim()
  if (payload === '') return { proseText, choices: null, hadTag: true }
  try {
    const parsed = parseJsonLenient(payload)
    const choices = parseSubmittedChoices(parsed, { card, chat, scriptMode: false, lenientGlobal: true, logger })
    return { proseText, choices, hadTag: true }
  } catch (_error) {
    return { proseText, choices: null, hadTag: true }
  }
}

export const CANDIDATE_SUBMIT_TOOL_NAME = 'candidate_submit_choices'

export const CANDIDATE_SUBMIT_TOOL = Object.freeze({
  name: CANDIDATE_SUBMIT_TOOL_NAME,
  description: '提交本轮候选项。自由故事提交 actors（按焦点对手戏角色优先排列的在场角色行动分组，含第一人称「我」或第三人称角色名）、event（1 条当前场景突发互动/事件）、scene（1 条场景切换），以及 featured（2–4 条由不同角色及可选事件/场景融合顺写而成的精简连贯精选调度）；剧本模式只提交 1 项变化，填入 actions 或 scene，另一项留空。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      actors: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            actions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1 } },
            routeTags: { type: 'array', minItems: 0, maxItems: 4, items: { type: 'string' }, description: '与 actions 下标一一对应的可选剧情路线短签（当上下文提供 plot_compass_candidates 时填写）' }
          },
          required: ['name', 'actions']
        }
      },
      event: { type: 'string' },
      eventRouteTag: { type: 'string' },
      actions: { type: 'array', minItems: 0, maxItems: 4, items: { type: 'string', minLength: 1 } },
      scene: { type: 'string' },
      sceneRouteTag: { type: 'string' },
      featured: {
        type: 'array',
        minItems: 0,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            actors: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1 } },
            event: { type: 'boolean' },
            scene: { type: 'boolean' },
            routeTag: { type: 'string', description: '可选剧情路线短签（对应剧情罗盘路线 tag）' },
            text: { type: 'string', minLength: 1 }
          },
          required: ['actors', 'text']
        }
      }
    }
  })
})

export const SCRIPT_READ_TOOL = Object.freeze({
  name: 'tavern_read_script',
  description: '只读剧本：用 position 读取任意剧本块，或用 query 检索整本剧本，两者都不移动游标。position 和 query 二选一，只填一个。最多查询 6 次，用完后根据已有材料提交最终候选。',
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1, description: '要读取的 1 起始剧本块号；总块数加 1 表示剧本结束。' },
      query: { type: 'string', description: '要在整本剧本中检索的关键词。' }
    },
    additionalProperties: false
  }
})

export const SCRIPT_POINT_TOOL = Object.freeze({
  name: 'tavern_point_script',
  description: '请求把下一轮剧本游标定位到指定块。只能保持当前位置或向前跳，不能后退；总块数加 1 表示剧本结束。调用只暂存请求，候选成功后才会一起提交。',
  countsTowardLimit: false,
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1, description: '要定位的 1 起始剧本块号；只能保持或向前跳，总块数加 1 表示剧本结束。' }
    },
    additionalProperties: false
  }
})

function scriptResearchAttempt(script, scriptWindow, card, chat) {
  const total = script.chunks.length
  const initial = Math.max(0, Math.min(total, Number(scriptWindow && scriptWindow.cursor) || 0))
  let pointed = null

  function positionResult(position, extra) {
    if (position >= total) {
      return Object.assign({
        title: str(script.title), totalChunks: total, position: total + 1,
        ended: true, message: '已经到达剧本结尾。', chunks: []
      }, extra || {})
    }
    const chunk = script.chunks[position]
    const projected = projectAgentContent(chunk.text, {
      charName: str(card && card.name),
      macroState: chat && chat.macroState
    })
    return Object.assign({
      title: str(script.title), totalChunks: total, position: position + 1,
      ended: false, chunks: [{ id: chunk.id, number: position + 1, text: projected.agentText }]
    }, extra || {})
  }

  async function onToolCall(call) {
    if (call === null || typeof call !== 'object') throw new Error('未知候选项研究工具')
    const args = call.arguments !== null && typeof call.arguments === 'object'
      ? call.arguments
      : parseJsonLenient(call.arguments)
    if (call.name === SCRIPT_POINT_TOOL.name) {
      const requested = Number(args.position)
      if (!Number.isInteger(requested) || requested < 1 || requested > total + 1) throw new Error('剧本定位的 position 必须是 1 到 ' + (total + 1) + ' 的整数')
      const before = pointed === null ? initial : pointed
      pointed = Math.max(before, requested - 1)
      return JSON.stringify({
        title: str(script.title), totalChunks: total,
        requestedPosition: requested,
        pointedAt: pointed >= total ? null : pointed + 1,
        pointedToEnd: pointed >= total,
        ignoredBackward: requested - 1 < before,
        pending: true,
        message: '定位请求已暂存；候选成功后才会提交。'
      })
    }
    if (call.name !== SCRIPT_READ_TOOL.name) throw new Error('未知候选项研究工具')
    const query = str(args.query).trim()
    const hasQuery = query !== ''
    const hasPosition = args.position !== undefined
    if (Number(hasQuery) + Number(hasPosition) !== 1) throw new Error('读取剧本必须且只能提供 position 或 query')
    if (hasQuery) {
      const needle = query.toLocaleLowerCase()
      const found = script.chunks.findIndex(function (chunk) { return str(chunk.text).toLocaleLowerCase().includes(needle) })
      if (found < 0) {
        return JSON.stringify({
          title: str(script.title), totalChunks: total,
          ended: false, notFound: true, message: '没有找到包含该关键词的剧本块。', chunks: []
        })
      }
      return JSON.stringify(positionResult(found, { matchedQuery: query }))
    }
    const requested = Number(args.position)
    if (!Number.isInteger(requested) || requested < 1 || requested > total + 1) throw new Error('读取剧本的 position 必须是 1 到 ' + (total + 1) + ' 的整数')
    return JSON.stringify(positionResult(requested - 1))
  }

  return { onToolCall, pointedPosition: function () { return pointed } }
}

export function createCandidateGenerator(options) {
  if (options === null || typeof options !== 'object') throw new Error('缺少候选项生成依赖')
  if (typeof options.prompt !== 'function') throw new Error('缺少提示词目录')
  const prompt = options.prompt
  const store = options.store
  const model = options.model
  const planner = options.planner
  const scripts = options.scripts
  const timeline = options.timeline
  const tasks = options.tasks || createBackgroundTaskCoordinator({ store, timeline })
  const characterDesign = options.characterDesign
  const waitUntilSettled = typeof options.waitUntilSettled === 'function' ? options.waitUntilSettled : async function () {}
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console

  async function prepare(input) {
    async function reportStage(stage) {
      if (typeof input.onStage !== 'function') return
      try {
        await input.onStage(stage)
      } catch (error) {
        if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 候选任务阶段 ${stage} 发布失败，将继续执行并由持久状态恢复：${str(error && error.message || error)}`)
      }
    }
    let chat = await store.chatForSession(input.sessionId)
    if (chat === undefined || chat === null) throw new Error('当前会话没有绑定人物卡')
    const mode = chat.mode || 'story'
    if (mode === 'card') throw new Error('卡片模式不生成剧情候选项')
    const requestId = str(input.requestId).trim().slice(0, 160)
    let taskRun = null
    const activity = tasks.activity(chat)
    if (activity.busy) {
      try { taskRun = await tasks.begin(chat, 'candidate', { requestId, bindExistingSession: true, prepareCommit: input.prepareCommit }) }
      catch (_error) { throw new Error('后台 Agent 正在执行 ' + activity.role + '，请等待完成后再生成候选项') }
    }
    function preparedValue() {
      if (typeof input.onStarted === 'function') input.onStarted({ operationId: taskRun.operationId, basedOn: taskRun.basedOn })
      if (taskRun.created !== false) return null
      return Object.freeze({
        operationId: taskRun.operationId,
        basedOn: taskRun.basedOn,
        created: false,
        async execute() { throw new Error('重复的候选启动请求不能再次执行') }
      })
    }
    if (taskRun !== null) {
      const duplicate = preparedValue()
      if (duplicate !== null) return duplicate
    }
    await waitUntilSettled(chat)
    chat = await store.readChat(chat.id)
    if (chat === undefined) throw new Error('聊天不存在')
    const expectedTimeline = { branchId: str(chat.timeline?.branchId), revision: Number(chat.timeline?.revision) || 0 }
    const cardPath = str(chat.cardPath || chat.cardId)
    const card = await store.readCard(cardPath, chat)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const selection = model.selection(chat)
    if (selection === null || selection === undefined) throw new Error('没有可用的模型配置')
    const scriptMode = mode === 'script'
    let script = null
    let scriptWindow = null
    if (scriptMode) {
      script = scriptForState(await store.readScript(cardPath), chat.scriptState)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) throw new Error('剧本文件不存在，请重新为人物卡导入剧本')
      scriptWindow = scripts.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } })
    }
    const backgroundTasks = await options.backgroundTasks?.(chat)
    const designEnabled = backgroundTasks?.characterDesign !== false
    const task = prompt(scriptMode ? 'candidate-script' : 'candidate-story')
    const preparedWorldbook = typeof options.worldBookContext === 'function' ? await options.worldBookContext(chat, card) : undefined
    const constantWorldBookContext = preparedWorldbook !== undefined ? preparedWorldbook.context : typeof options.stableWorldBookContext === 'function'
      ? await options.stableWorldBookContext(chat, card) : ''
    const context = await planner.plan({ purpose: 'candidate', card, chat, task, scriptWindow, constantWorldBookContext })
    taskRun = await tasks.begin(chat, 'candidate', { requestId, bindExistingSession: true, prepareCommit: input.prepareCommit, expectedTimeline })
    chat = taskRun.chat
    const duplicate = preparedValue()
    if (duplicate !== null) return duplicate
    const currentScriptWindow = scriptMode ? scripts.inspect({ script, state: chat.scriptState, request: { kind: 'choice' } }) : null
    if (scriptMode && (currentScriptWindow.cursor !== scriptWindow.cursor || currentScriptWindow.sourceOffset !== scriptWindow.sourceOffset || currentScriptWindow.chunkSize !== scriptWindow.chunkSize)) {
      const error = new Error('剧本游标已变化，请重新生成候选项')
      await taskRun.fail(error)
      throw error
    }
    const participantRequest = taskRun.participantRequest
    const persistentSessionId = str(participantRequest.sessionId)
    const guidance = str(input.guidance).trim().slice(0, 600)
    let request = PROMPT_PROSE.p001
    if (guidance !== '') request += TASK_PROMPT_PROSE.p001 + guidance + TASK_PROMPT_PROSE.p002 + (scriptMode ? TASK_PROMPT_PROSE.p003 : TASK_PROMPT_PROSE.p004)
    // A synced participant revision records task commits, not delivery of story text.
    // Always anchor choices in the current timeline, even in a persistent background session.
    const recentMessages = buildMessages(chat, card, selection, now)
    request += TASK_PROMPT_PROSE.p005 + taskRun.basedOn.revision +
      TASK_PROMPT_PROSE.p006 + (chat.messages?.findLast(message => message.role === 'assistant')?.turn || 0) +
      TASK_PROMPT_PROSE.p007
    if (chat.macroState?.userName) request += TASK_PROMPT_PROSE.p008 + chat.macroState.userName + TASK_PROMPT_PROSE.p009
    const messages = recentMessages.concat([{
      id: 'choices-' + now().toString(36),
      role: 'user',
      content: [{ type: 'text', text: promptSection('candidate_request', request) }],
      source: { kind: 'plugin:dsh-tavern' }
    }])
    const research = scriptMode ? scriptResearchAttempt(script, scriptWindow, card, chat) : null
    let submittedChoices = null
    let submissionError = null
    async function onToolCall(call) {
      if (call && (call.name === CHARACTER_DESIGN_READ_TOOL.name || call.name === CHARACTER_DESIGN_SAVE_TOOL.name)) {
        if (!designEnabled) return JSON.stringify({ ok: false, error: '人物设计已关闭' })
        if (!characterDesign || typeof characterDesign.execute !== 'function') {
          return JSON.stringify({ ok: false, retryable: false, error: '人物设计存储不可用，请继续完成候选生成' })
        }
        return await characterDesign.execute(chat.id, call)
      }
      if (call && call.name === CANDIDATE_SUBMIT_TOOL_NAME) {
        try {
          const args = call.arguments !== null && typeof call.arguments === 'object' ? call.arguments : parseJsonLenient(call.arguments)
          submittedChoices = parseSubmittedChoices(args, { card, chat, scriptMode, lenientGlobal: false, logger })
          submissionError = null
          return JSON.stringify({ ok: true, accepted: submittedChoices.length })
        } catch (error) {
          submittedChoices = null
          submissionError = error
          return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
        }
      }
      if (research !== null) return research.onToolCall(call)
      return JSON.stringify({ ok: false, retryable: true, error: '当前候选任务只允许调用 candidate_submit_choices' })
    }
    const callOptions = {
      ...options.requestAnchor?.(chat, taskRun),
      onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
      preparedWorldbook,
      sessionId: input.sessionId,
      task: 'candidate',
      backgroundTasks,
      selection,
      temperature: 0.8,
      system: [
        context.taskText,
        ...(designEnabled ? ['若确实需要建立、补全或修订长期人物设计，在当前后台 Agent 内调用 skill 加载 character-design，并按 Skill 使用人物档案工具；在这个 Agent 里做就行，不另建 Agent。完成后继续提交候选项。'] : [])
      ].join('\n\n'),
      backgroundContext: context.stableText,
      turnContext: context.dynamicText,
      candidateScriptWindow: context.candidateScriptWindow,
      systemPromptText: context.systemPromptText,
      postHistoryText: context.postHistoryText,
      messages,
      persistent: true,
      persistentSessionId,
      rewindTo: participantRequest.rewindTo,
      rewindFormatVersion: participantRequest.formatVersion,
      webSearchEnabled: chat.webSearchEnabled === true
    }
    async function execute() {
      let run
      try {
        await reportStage('generating')
        run = await model.runCandidate(Object.assign({}, callOptions, {
          tools: [...(scriptMode ? [SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL] : []), ...(designEnabled ? [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL] : []), CANDIDATE_SUBMIT_TOOL],
          onToolCall,
          maxToolCalls: scriptMode ? 15 : 10,
          stopToolsWhen: function () { return submittedChoices !== null },
          acceptWithoutText: function () { return submittedChoices !== null }
        }))
      } catch (error) {
        await taskRun.fail(error).catch(function (persistError) {
          if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 候选模型失败后无法持久化终态：${str(persistError && persistError.message || persistError)}`)
        })
        if (logger && typeof logger.error === 'function') logger.error('dsh-tavern: 候选项生成失败:', str(error && error.message || error))
        throw candidateFailure('generating', '候选 Agent 生成失败', error)
      }
      const text = run.text
      const traceSessionId = str(run.traceSessionId)
      const participant = taskRun.participant(run)
      let choices
      try {
        await reportStage('validating')
        if (submittedChoices === null) throw submissionError || new Error('模型未调用 candidate_submit_choices 提交有效候选项')
        choices = submittedChoices
      } catch (error) {
        if (logger && typeof logger.error === 'function') {
          logger.error('dsh-tavern: 候选项输出无效:', str(error && error.message || error))
          logger.error('dsh-tavern: 候选项原始输出:', str(text).slice(0, 1200))
        }
        await taskRun.commit({ stateChanged: false, participant }).catch(function (persistError) {
          if (logger && typeof logger.warn === 'function') logger.warn(`dsh-tavern: 候选输出无效后无法持久化终态：${str(persistError && persistError.message || persistError)}`)
        })
        throw candidateFailure('validating', '候选输出无效', error)
      }
      let savedCandidates = null
      let completed
      try {
        await reportStage('committing')
        completed = await taskRun.commit({
          // Choices change no story: only a script's cursor moves the story revision, which
          // would otherwise void work fenced on it, like this turn's stage director.
          stateChanged: scriptMode,
          headerOnly: true,
          participant,
          apply(draft) {
            let scriptProjection
            if (scriptMode) {
              const pointed = research.pointedPosition()
              if (pointed === script.chunks.length) {
                draft.scriptState = scripts.transition({ script, state: draft.scriptState, event: { kind: 'end' } }).state
              } else if (Number.isInteger(pointed) && pointed >= 0) {
                draft.scriptState = scripts.transition({ script, state: draft.scriptState, event: { kind: 'focus', cursor: pointed + 1 } }).state
              }
              const progress = scripts.inspect({ script, state: draft.scriptState, request: { kind: 'progress' } })
              scriptProjection = { cursor: progress.cursor, ended: progress.cursor >= progress.totalChunks }
            }
            draft.candidates = {
              messageId: str(input.messageId), choices, generatedAt: now(), script: scriptProjection,
              requestId, operationId: taskRun.operationId,
              traceSessionId, traceSessionIds: traceSessionId === '' ? [] : [traceSessionId],
              traceMode: 'continuable', basedOn: taskRun.basedOn
            }
            savedCandidates = draft.candidates
          }
        })
      } catch (error) {
        throw candidateFailure('committing', '候选已经生成，但保存失败', error)
      }
      if (completed.status === 'missing') throw new Error('聊天不存在: ' + chat.id)
      if (completed.status !== 'committed') throw new Error('剧情状态已变化，本次候选项已作废，请重新生成')
      await reportStage('publishing')
      return {
        messageId: savedCandidates.messageId,
        choices: savedCandidates.choices,
        generatedAt: savedCandidates.generatedAt,
        requestId: savedCandidates.requestId,
        operationId: savedCandidates.operationId,
        traceSessionId: savedCandidates.traceSessionId,
        traceSessionIds: savedCandidates.traceSessionIds,
        traceMode: savedCandidates.traceMode,
        basedOn: savedCandidates.basedOn
      }
    }
    return Object.freeze({ operationId: taskRun.operationId, basedOn: taskRun.basedOn, created: true, startCommitted: taskRun.startCommitted === true, execute })
  }

  async function generate(input) {
    const prepared = await prepare(input)
    return await prepared.execute()
  }

  async function find(input) {
    const chat = await (store.stateForSession || store.chatForSession)(input.sessionId)
    if (chat === undefined || chat.candidates === null || typeof chat.candidates !== 'object') return null
    // 前台候选项只留最近一轮（提交时无候选即清空）。页面手里的消息 id 可能是宿主
    // 生成的另一套（工具回复、重新生成各有一个），所以页面按「最近一轮」读（latest），
    // 其余调用方仍按消息 id 精确核对。
    const asked = str(input.messageId)
    if (input.latest !== true && str(chat.candidates.messageId) !== asked) return null
    const isScript = (chat.mode || 'story') === 'script'
    const limit = isScript ? 1 : MAX_SAVED_STORY_CHOICES
    const choices = Array.isArray(chat.candidates.choices) ? chat.candidates.choices.map(function (item) {
      if (item === null || typeof item !== 'object') return null
      const normalizedType = choiceType(item.type)
      const type = isScript && normalizedType === 'event' ? 'action' : (normalizedType || 'action')
      const text = str(item.text).trim()
      const routeTag = str(item.routeTag).replace(/^[【〔\[]+|[】〕\]]+$/g, '').trim().slice(0, 12)
      if (type === 'featured') {
        if (isScript) return null
        const actors = Array.isArray(item.actors) ? item.actors.map(function (name) { return str(name).trim() }).filter(Boolean) : []
        return {
          type,
          ...(actors.length > 0 ? { actors } : {}),
          ...(item.hasEvent === true ? { hasEvent: true } : {}),
          ...(item.hasScene === true ? { hasScene: true } : {}),
          ...(routeTag !== '' ? { routeTag } : {}),
          text
        }
      }
      const actor = !isScript && type === 'action' ? str(item.actor).trim() : ''
      return {
        type,
        ...(actor !== '' ? { actor } : {}),
        ...(routeTag !== '' ? { routeTag } : {}),
        text
      }
    }).filter(function (item) { return item !== null && item.text !== '' }).slice(0, limit) : []
    if (choices.length === 0) return null
    const traceSessionIds = Array.isArray(chat.candidates.traceSessionIds) ? chat.candidates.traceSessionIds.map(str).filter(function (id) { return id !== '' }) : []
    const traceSessionId = str(chat.candidates.traceSessionId) || traceSessionIds[traceSessionIds.length - 1] || ''
    return {
      messageId: str(chat.candidates.messageId), choices, generatedAt: Number(chat.candidates.generatedAt) || 0,
      requestId: str(chat.candidates.requestId), operationId: str(chat.candidates.operationId),
      traceSessionId, traceSessionIds, traceMode: chat.candidates.traceMode === 'continuable' ? 'continuable' : 'one-shot',
      basedOn: chat.candidates.basedOn || null
    }
  }

  return Object.freeze({ prepare, generate, find })
}
