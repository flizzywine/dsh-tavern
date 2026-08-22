export function isTrueBoolean(value) {
  return ['on', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())
}

export function isFalseBoolean(value) {
  return ['off', 'false', '0'].includes(String(value ?? '').trim().toLowerCase())
}
