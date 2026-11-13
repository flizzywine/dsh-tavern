// The background task pipeline (Wiki「设计：background-task-pipeline」).
//
// Settlement items: work that rides on the main settlement's single model call. Tavern's own
// items come first, then the plugins' tools and notes. Tool definitions
// sit in the background session's cached prefix and never change; which may be called this
// turn is stated in the per-turn task text.

import { promptSection } from './prompt-section.js'

function pluginText(names, notes) {
  if (!notes.length && !names.available.length && !names.unavailable.length) return ''
  return promptSection('plugin_task', promptSection('plugin_settlement', [
    ...(names.available.length ? ['Plugin tools available this turn: ' + names.available.join('、') + ". This list is current; earlier turns where they were off or failed no longer apply. Call them as needed before submitting this turn's settlement; a plugin tool failure doesn't affect it."] : []),
    ...(names.unavailable.length ? ['Plugin tools unavailable this turn (the player turned off their plugins for this game): ' + names.unavailable.join('、') + ". Don't call them this turn."] : []),
    ...notes.map(note => note.text)].join('\n\n')))
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
  requirement: 'Character design task started manually by the user. With empty design notes, pick the important characters needing a new or fuller design from the current story and existing files; with notes, follow them first. ',
  protocol: "Load character-design with skill, then check this game's lorebook and existing files by name or alias with character_design_read. If the lorebook already defines a character, character_design_reuse completes it with no new file; call character_design_save only for new characters without a definition or to revise an existing design file. Leave variables, postures and story text untouched.",
  system() { return this.requirement + this.protocol }
})

export function createLedgerItem({ rules }) {
  return Object.freeze({
    id: 'tavern.ledger',
    trigger: 'manual',
    requirement: 'This is a ledger update the player started manually. The ledger is a memo for the player, and the next story turn reads it once after the update. ',
    rules,
    protocol: ({ from, through }) => 'Read the given story (turns ' + from + '–' + through + '), compare it with the current ledger, and call ledger_submit once with the changes that story brings; submit {} if nothing changed. Leave story text, variables and postures untouched.',
    system(range) { return this.requirement + this.protocol(range) + '\n\n' + this.rules }
  })
}
