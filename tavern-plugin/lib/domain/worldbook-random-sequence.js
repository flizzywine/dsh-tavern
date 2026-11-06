/** Portable per-entry sequence, shared by browser templates and native macro projection. */
export function entryRandom(seed, ref) {
  let state = 2166136261
  for (const char of `${seed}:${ref}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619)
  return () => {
    let value = state += 0x6D2B79F5
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}
