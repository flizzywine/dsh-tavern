// pi-ai maps Gemini's finish reasons through a closed switch over the SDK enum it
// was built with, and throws `Unhandled stop reason: X` for anything newer. Gemini
// keeps adding reasons (MALFORMED_RESPONSE arrived after @google/genai's enum), so
// a newer reason turned an ordinary provider stop into a crash message. Every
// non-success reason already maps to "error", which pi-ai reports as
// `Provider stopped with: X`; an unknown one is the same kind of stop.

export const PI_AI_GOOGLE_STOP_REASON_MARKER = '/* dsh-tavern:pi-ai-google-stop-reason */'

const THROWING_DEFAULT = '        default: {\n            const _exhaustive = reason;\n            throw new Error(`Unhandled stop reason: ${_exhaustive}`);\n        }\n'

/** Map finish reasons pi-ai does not know to "error" instead of throwing. */
export function patchPiAiGoogleStopReasonSource(source) {
  const text = String(source)
  if (text.includes(PI_AI_GOOGLE_STOP_REASON_MARKER)) return { status: 'patched', text }
  const at = text.indexOf(THROWING_DEFAULT)
  if (at < 0 || at !== text.lastIndexOf(THROWING_DEFAULT)) return { status: 'unmatched', text }
  const patched = text.slice(0, at) + `        ${PI_AI_GOOGLE_STOP_REASON_MARKER}\n        default:\n            return "error";\n` + text.slice(at + THROWING_DEFAULT.length)
  return { status: 'applied', text: patched }
}
