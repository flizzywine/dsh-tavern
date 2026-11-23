// Gemini 3+ generates a tool call freely by default (AUTO) and checks it against the tool's schema only afterwards: a call
// that does not pass is dropped with the whole round (finish reason MALFORMED_RESPONSE / MALFORMED_FUNCTION_CALL). On a long
// game at the low reasoning level this happened every time in one scene, and no rewording of the tool schema fixed it
// reliably (success moved with byte-level edits such as key order). VALIDATED decodes the call under the schema instead, so a malformed call
// cannot be produced; pi-ai already uses it for strict tools on these models. This makes it the default there whenever the
// caller asks for no particular tool choice; an explicit choice (none, any, auto) still wins.

export const PI_AI_GOOGLE_TOOL_MODE_MARKER = '/* dsh-tavern:pi-ai-google-validated */'

const DEFAULT_MODE = '    return toolChoice ? mapToolChoice(toolChoice) : undefined;\n}\n'
const FUNCTION = 'export function resolveGoogleFunctionCallingMode(tools, toolChoice, supportsStrictMode) {'

/** Default Gemini 3+ tool calls to VALIDATED when no tool choice is asked for. */
export function patchPiAiGoogleToolModeSource(source) {
  const text = String(source)
  if (text.includes(PI_AI_GOOGLE_TOOL_MODE_MARKER)) return { status: 'patched', text }
  const start = text.indexOf(FUNCTION)
  const at = start < 0 ? -1 : text.indexOf(DEFAULT_MODE, start)
  if (at < 0 || text.indexOf(FUNCTION, start + 1) >= 0) return { status: 'unmatched', text }
  const patched = text.slice(0, at) + `    ${PI_AI_GOOGLE_TOOL_MODE_MARKER}\n    if (!toolChoice && supportsStrictMode) {\n        return FunctionCallingConfigMode.VALIDATED;\n    }\n` + text.slice(at)
  return { status: 'applied', text: patched }
}
