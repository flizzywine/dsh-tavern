import {
  CHARACTER_DESIGN_READ_TOOL_NAME,
  CHARACTER_DESIGN_SAVE_TOOL_NAME
} from './character-design-document.js'

export const CHARACTER_DESIGN_FINISH_TOOL_NAME = 'character_design_finish'
export const CHARACTER_DESIGN_TEMPERATURE = 0.7

export const CHARACTER_DESIGN_FINISH_TOOL = Object.freeze({
  name: CHARACTER_DESIGN_FINISH_TOOL_NAME,
  description: '结束当前人物设计阶段并返回原后台任务。完成全部必要的人物档案读取和保存后必须调用；随后再提交姿势、变量或候选项。',
  countsTowardLimit: false,
  parameters: Object.freeze({ type: 'object', additionalProperties: false, properties: {} })
})

const FINAL_SUBMISSION_TOOLS = new Set(['posture_submit', 'mvu_submit_update', 'candidate_submit_choices'])

/** Keep creative character work independent from the deterministic task surrounding it. */
export function createCharacterDesignStage(options = {}) {
  let active = false
  const designTemperature = typeof options.temperature === 'number'
    ? options.temperature
    : CHARACTER_DESIGN_TEMPERATURE

  function temperature(baseTemperature) {
    return active ? designTemperature : baseTemperature
  }

  async function execute(name, next) {
    if (name === CHARACTER_DESIGN_FINISH_TOOL_NAME) {
      const wasActive = active
      active = false
      return JSON.stringify({ ok: true, finished: wasActive })
    }
    if (active && FINAL_SUBMISSION_TOOLS.has(name)) {
      return JSON.stringify({
        ok: false,
        retryable: true,
        error: '人物设计阶段尚未结束；请先调用 character_design_finish，再提交当前后台任务。'
      })
    }
    if (name === CHARACTER_DESIGN_READ_TOOL_NAME || name === CHARACTER_DESIGN_SAVE_TOOL_NAME) active = true
    return next()
  }

  return Object.freeze({ temperature, execute, active: function () { return active } })
}
