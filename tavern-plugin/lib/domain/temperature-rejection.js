// Only an explicit parameter rejection is safe to retry. Do not interpret an
// arbitrary error mentioning temperature (or a request echoed by a gateway).
export function isTemperatureRejection(error) {
  const message = String(error?.message ?? error ?? '').trim()
  const status = Number(error?.status ?? error?.statusCode ?? message.match(/^(?:HTTP\s*)?(\d{3})\b/i)?.[1])
  if (status !== 400) return false
  let detail = message.replace(/^(?:HTTP\s*)?400\s*:?\s*/i, '')
  if (detail.startsWith('{')) {
    try {
      const body = JSON.parse(detail)
      detail = String(body?.error?.message ?? body?.message ?? '')
    } catch { return false }
  }
  return /^unsupported value:\s*["'`]?temperature["'`]?\s+(?:does not support|is not supported)/i.test(detail)
    || /^(?:invalid|unsupported)\s+(?:value\s+(?:for\s+)?)?["'`]?temperature\b/i.test(detail)
    || /^["'`]?temperature["'`]?\s+(?:is\s+)?(?:not supported|unsupported|must be|must equal|only (?:supports|accepts|allows))/i.test(detail)
}
