// Source URL of a client file for tests that read client sources by their old body name. The files listed here moved
// verbatim into the stage package (B16 S1-zero: they ship only in dsh-tavern-stage's client); every other name stays in the
// core's src/client. One explicit list, no search or fallback.
const STAGE_CLIENT_FILES = new Set([
  'bubbles.js', 'bubble-modes.js', 'bubble-modals.js', 'bubble-presets.js',
  'asset-pack-card-ui.js', 'asset-pack-gen-ui.js', 'asset-pack-engine-ui.js', 'mod-manager.js',
])
export function clientSourceUrl(name) {
  return STAGE_CLIENT_FILES.has(name)
    ? new URL('../../tavern-plugin/packages/dsh-tavern-stage/src/client/' + name, import.meta.url)
    : new URL('../../tavern-plugin/src/client/' + name, import.meta.url)
}
