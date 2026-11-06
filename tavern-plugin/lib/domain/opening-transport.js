// Old clients receive complete previews. New clients request the shared data
// after template initialization, so only its final state crosses the wire.
export function openingPreviewPayload(preparation, transport) {
  return transport === 'deferred-v1' ? {} : { worldbook: preparation.worldbook, runtime: preparation.runtime }
}

export function openingInitializationPayload(preparation, compact) {
  if (compact !== true) return preparation
  // Runtime context already contains the same worldbook projection.
  return preparation.runtime ? { runtime: preparation.runtime } : { runtime: null, worldbook: preparation.worldbook }
}
