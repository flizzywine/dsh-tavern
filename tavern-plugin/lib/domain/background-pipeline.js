// The background task pipeline (Wiki「设计：background-task-pipeline」).
//
// Settlement items: work that rides on the main settlement's single model call. Tavern's own
// items come first, then the plugins' tools and notes. Tool definitions
// sit in the background session's cached prefix and never change; which may be called this
// turn is stated in the per-turn task text.

const PLUGIN_HEADER = '【插件附加的结算任务】'

function pluginText(names, notes) {
  if (!notes.length && !names.available.length && !names.unavailable.length) return ''
  return [PLUGIN_HEADER,
    ...(names.available.length ? ['本轮可用插件工具：' + names.available.join('、') + '。以本轮列出的为准：之前回合里这些工具被关闭或报错的情况已不再适用。需要时在提交本轮结算之前调用；插件工具失败不影响本轮结算。'] : []),
    ...(names.unavailable.length ? ['本轮不可用的插件工具（玩家在本局关闭了对应插件）：' + names.unavailable.join('、') + '。本轮不要调用。'] : []),
    ...notes.map(note => note.text)].join('\n\n')
}

/**
 * @param {object} input
 * @param {() => Array} input.items Tavern's own items: { tools(), has(name), section(context), call(name, args, context), wanted?() }
 * @param {() => object|null} input.plugins the plugin layer's settlement seam (plugin-api.js `settlement`)
 */
export function createSettlementItems({ items = () => [], plugins = () => null } = {}) {
  const own = () => (items() || []).filter(Boolean)

  return Object.freeze({
    /** Every item's tools, in the fixed order of the cached prefix. */
    tools() { return [...own().flatMap(item => item.tools()), ...(plugins()?.tools() || [])] },
    has(name) { return own().some(item => item.has(name)) || Boolean(plugins()?.has(name)) },
    /** Whether an item needs the settlement to run although posture and variables are off. */
    async wanted(context = {}) {
      for (const item of own()) if (typeof item.wanted === 'function' && await item.wanted(context)) return true
      return false
    },
    /** One settlement run's dispatcher; plugin tools are refused once the run has submitted. */
    calls(context, { stopped = () => false } = {}) {
      const group = plugins()
      const pluginCall = group ? group.calls(context) : null
      return async function call(name, args) {
        const item = own().find(entry => entry.has(name))
        if (item) return item.call(name, args, context)
        if (!pluginCall || !group.has(name)) return undefined
        if (stopped()) return JSON.stringify({ ok: false, retryable: false, message: '当前任务已经提交完成，请结束本轮。插件工具请在提交结算之前调用。' })
        return pluginCall(name, args)
      }
    },
    /** This turn's notes: each Tavern item, then the plugins' tools and notes. */
    async text(context) {
      const group = plugins()
      const notes = group ? await group.sections(context) : []
      const parts = []
      for (const item of own()) parts.push(await item.section(context).catch(() => ''))
      const names = group ? await group.toolNames(context) : { available: [], unavailable: [] }
      parts.push(pluginText(names, notes))
      return parts.filter(Boolean).join('\n\n')
    }
  })
}

// Tavern's posture item. Its text is two parts: the requirement (replaceable later) and the
// protocol (which tool submits, and that it ends the run), so a new requirement cannot break it.
export const NO_POSTURE_REQUIREMENT = '本轮不生成或提交姿势。完成启用的后台任务后简短回复完成。'

export function createPostureItem({ prompt, tool }) {
  return Object.freeze({
    id: 'tavern.posture',
    trigger: 'auto',
    tool,
    requirement: () => prompt(),
    protocol: tool.name + ' 是本任务最后一步。'
  })
}

/** What the plain settlement engine sends: posture, when on, is its only terminal item. */
export function plainSettlementPlan({ posture }) {
  return {
    system: [posture ? posture.requirement() : NO_POSTURE_REQUIREMENT, posture ? posture.protocol : ''].join('\n\n'),
    tools: posture ? [posture.tool] : []
  }
}

/**
 * One turn's pipeline: stages run in order, each only when its condition holds.
 * The settlement job runs the closing stage (onSettled) once these are done and not stopped.
 */
export async function runPipelineStages(stages) {
  for (const stage of stages) {
    if (typeof stage.when === 'function' && !await stage.when()) continue
    await stage.run()
  }
}

// Manual settlement items: the player starts them; each runs as its own background task in the
// shared background session (the 'character-design' and 'ledger' roles), not inside a turn's settlement.
export const CHARACTER_DESIGN_ITEM = Object.freeze({
  id: 'tavern.character-design',
  trigger: 'manual',
  requirement: '本次执行用户手动发起的人物设计。设计意见留空时，根据当前剧情和已有档案，自行选择需要建立或补充设计的重要人物；有意见时优先遵循意见。',
  protocol: '先调用 skill 加载 character-design，再用 character_design_read 按姓名或别名检查本局世界书与已有档案。世界书已有该人物设定时调用 character_design_reuse 复用即可完成，不另建档案；只有缺少设定的新人物或已有设计档案的修订才调用 character_design_save。不得执行变量或姿势结算，不得改写正文。',
  system() { return this.requirement + this.protocol }
})

export function createLedgerItem({ rules }) {
  return Object.freeze({
    id: 'tavern.ledger',
    trigger: 'manual',
    requirement: '本次执行玩家手动发起的台账整理。台账是给玩家查阅的备忘录，整理后下一轮正文会参考一次。',
    rules,
    protocol: ({ from, through }) => '阅读给出的剧情（第 ' + from + '–' + through + ' 轮），对照当前台账，调用一次 ledger_submit 提交这些剧情带来的增量；没有变化也提交 {}。不得改写正文、变量或姿势。',
    system(range) { return this.requirement + this.protocol(range) + '\n\n' + this.rules }
  })
}
