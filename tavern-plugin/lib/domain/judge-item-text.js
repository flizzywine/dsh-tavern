import { promptSection } from './prompt-section.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: (value0, value1, value2) => `Does this asset fit this turn's story? [${value0}] ${value1}; use when: ${value2}`
})

// Credits do not distinguish use cases. Keep semantic descriptions and question wording:
// Jev replay loses valid sound cues when given a bare name/description instead.
export function judgeItemText(name, description = '', kind) {
  const note = description
    .replace(/;\s*based on\s+[^.!?。]+\s+by\s+[^.!?。]+(?:[.!?。]|$)/gi, '.')
    .replace(/(?:[;；]\s*|^|(?<=[.!?。])\s*)(?:licensed under|licen[cs]e:|copyright\s)[^.!?。]+(?:[.!?。]|$)/gi, ' ')
    .trim()
  return promptSection('judge_request', PROMPT_PROSE.p001(kind, name, note))
}
