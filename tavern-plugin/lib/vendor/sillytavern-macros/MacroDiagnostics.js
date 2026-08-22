let activeDiagnostics = null

function record(level, detail) {
  if (activeDiagnostics === null) return
  activeDiagnostics.push({ level, message: String(detail && detail.message || 'Macro diagnostic') })
}

export function collectMacroDiagnostics(run) {
  const previous = activeDiagnostics
  const diagnostics = []
  activeDiagnostics = diagnostics
  try {
    return { value: run(), diagnostics }
  } finally {
    activeDiagnostics = previous
  }
}

export function createMacroRuntimeError(detail) {
  const error = new Error(String(detail && detail.message || detail || 'Macro runtime error'))
  error.name = 'MacroRuntimeError'
  error.isMacroRuntimeError = true
  if (detail && typeof detail === 'object') Object.assign(error, detail)
  return error
}

export function logMacroRegisterError(detail) { record('error', detail) }
export function logMacroRegisterWarning(detail) { record('warning', detail) }
export function logMacroRuntimeWarning(detail) { record('warning', detail) }
export function logMacroGeneralError(detail) { record('error', detail) }
export function logMacroInternalError(detail) { record('error', detail) }
export function logMacroSyntaxWarning(detail) { record('warning', detail) }
