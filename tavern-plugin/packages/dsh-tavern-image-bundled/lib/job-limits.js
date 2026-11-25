export const DEFAULT_IMAGE_CONCURRENCY = 2
export const MAX_IMAGE_CONCURRENCY = 100
export const MAX_CARD_IMAGE_BATCH = 100

export function normalizeImageConcurrency(value) {
  return Math.max(1, Math.min(MAX_IMAGE_CONCURRENCY, Math.trunc(Number(value)) || DEFAULT_IMAGE_CONCURRENCY))
}
