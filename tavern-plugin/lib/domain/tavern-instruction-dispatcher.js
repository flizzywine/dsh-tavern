function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function instructionSource(instruction) {
  const source = instruction && instruction.source
  return source !== null && typeof source === 'object' && !Array.isArray(source) ? clone(source) : {}
}

const FOREGROUND_SLOTS = Object.freeze({
  'foreground.card-context': 'cardContext',
  'foreground.active-worldbook': 'activeWorldbook',
  'foreground.current-state': 'currentStateProjection',
  'foreground.script-reference': 'scriptReference',
  'foreground.guide': 'guide',
  'foreground.writing-rules': 'writingRules'
})

function emptyResult() {
  return {
    userInput: null,
    contributions: [],
    context: {
      cardContext: [],
      activeWorldbook: [],
      currentStateProjection: [],
      scriptReference: [],
      guide: [],
      writingRules: []
    },
    backgroundTasks: [],
    harnessActions: [],
    presentationActions: [],
    ignored: [],
    diagnostics: []
  }
}

function foregroundContribution(result, instruction, slot) {
  const text = str(instruction.text).trim()
  if (text === '') return
  const contribution = {
    kind: str(instruction.kind),
    slot,
    text,
    required: instruction.required === true,
    source: instructionSource(instruction)
  }
  result.context[slot].push(contribution)
  result.contributions.push(contribution)
}

/**
 * Translate normalized Tavern instructions into dsh-tavern Runtime targets.
 * The single dispatch interface is shared by production callers and tests.
 */
export function createTavernInstructionDispatcher() {
  function dispatch(instructions) {
    const result = emptyResult()
    for (const [index, raw] of (Array.isArray(instructions) ? instructions : []).entries()) {
      const instruction = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      const kind = str(instruction.kind)
      if (kind === 'foreground.user-input') {
        result.userInput = {
          sourceText: str(instruction.sourceText),
          projectedText: str(instruction.projectedText),
          source: instructionSource(instruction)
        }
        continue
      }
      const slot = FOREGROUND_SLOTS[kind]
      if (slot !== undefined) {
        foregroundContribution(result, instruction, slot)
        continue
      }
      if (kind === 'background.task') {
        result.backgroundTasks.push(clone(instruction.task || {}))
        continue
      }
      if (kind === 'harness.action') {
        result.harnessActions.push(clone(instruction.action || {}))
        continue
      }
      if (kind === 'presentation.action') {
        result.presentationActions.push(clone(instruction.action || {}))
        continue
      }
      const ignored = {
        index,
        kind: kind || 'unknown',
        source: instructionSource(instruction),
        reason: str(instruction.reason) || 'unsupported-instruction'
      }
      result.ignored.push(ignored)
      result.diagnostics.push({
        code: 'TAVERN_INSTRUCTION_IGNORED',
        severity: 'warning',
        instruction: ignored
      })
    }
    return result
  }

  return Object.freeze({ dispatch })
}

