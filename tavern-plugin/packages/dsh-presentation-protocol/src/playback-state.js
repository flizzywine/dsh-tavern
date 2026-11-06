const clone = value => structuredClone(value)

function widgetState(state) {
  return { version: 1, time: state.widgetTime || 0, scene: state.scene || '', widgets: clone(Object.values(state.widgets || {})) }
}

export function projectIncrementalStageState(state, catalog, metadata = {}) {
  const outfits = {}, positions = {}, focus = {}, look = {}, figureLight = {}
  for (const [id, actor] of Object.entries(state.actors || {})) {
    outfits[id] = actor.variant === catalog.actors[id]?.defaultVariant ? '' : catalog.actors[id]?.variantLabels?.[actor.variant] ?? actor.variant
    // retain historical receipts, not their distance/coordinate choreography.
    positions[id] = 'auto'
    focus[id] = 'normal'
    look[id] = actor.gaze || 'viewer'
    figureLight[id] = actor.figureLight || 'lit'
  }
  return { protocol: 'incremental-v1', scene: state.scene || '', sceneCleared: state.scene === null, cast: [...state.cast], order: [...state.cast], outfits, positions, focus, look, figureLight,
    music: state.music || '', weather: state.weather || 'none',
    // Shared soundscape replay input (stage-soundscape.cjs): scene + weather + deviation tags.
    soundscape: { scene: state.scene || '', weather: state.weather || 'none', tags: [...(state.sound || [])] },
    light: state.lighting?.mood !== 'none' ? state.lighting?.mood : state.lighting?.time || 'auto',
    lighting: clone(state.lighting || { time: 'auto', mood: 'none' }), camera: { value: state.camera?.mode || 'reset', ...(state.camera?.actor ? { id: state.camera.actor } : {}) },
    dof: state.dof || 'off', widgetState: widgetState(state),
    ...(metadata.figureScale ? { figureScale: clone(metadata.figureScale) } : {}),
    ...(metadata.assetRefs ? { assetRefs: clone(metadata.assetRefs) } : {}) }
}
