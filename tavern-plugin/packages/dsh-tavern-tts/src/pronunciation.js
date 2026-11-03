// the one user dictionary is the reading presets (发音字典). This file is
// only the fixed dash normalisation applied after them to every line. The former built-in Latin-word readings (Wi-Fi, AI,
// OK, Claude, GPT — the 「字母词」) are gone for good; a reading is a 发音字典 entry.
const dash = /[-\u2010-\u2015\u2212\ufe63\uff0d]/gu
const latinToken = /[\p{Script=Latin}\p{M}\d]+(?:[-\u2010-\u2015\u2212\ufe63\uff0d][\p{Script=Latin}\p{M}\d]+)+/gu
export function normalizeDashes(text) {
  // Limit math context to a numeric expression, not an unrelated sign elsewhere in the prose.
  return text.replace(/\d+(?:\.\d+)?(?:\s*[=+\u00d7*/\u00f7\-\u2010-\u2015\u2212\ufe63\uff0d]\s*\d+(?:\.\d+)?)+/gu,
    expression => /[=+\u00d7*/\u00f7]/u.test(expression) || /\d\s+[-\u2010-\u2015\u2212\ufe63\uff0d]\s+\d/u.test(expression) ? expression.replace(dash, '\u51cf') : expression)
    .replace(latinToken, token => /\p{Script=Latin}/u.test(token) ? token.replace(dash, ' ') : token)
    .replace(/(?<=\d)[-\u2010-\u2015\u2212\ufe63\uff0d](?=\d)/gu, '\u5230')
    .replace(/(^|[\s(\[\{\uff08\u3010])[-\u2010-\u2015\u2212\ufe63\uff0d](?=\d)/gu, '$1\u8d1f')
}
