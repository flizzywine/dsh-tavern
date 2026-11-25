// source-only tests follow moved algorithms, not relocation entry points.
const moved = new Set(['figure-scale.cjs', 'stage-phone.cjs', 'stage-soundscape.cjs', 'stage-light.cjs', 'stage-pacing.cjs'])
export const presentationSourceUrl = (name, root = new URL('../../tavern-plugin/', import.meta.url)) => name === 'stage-phone.cjs' ? new URL('../tavern-plugin/mods/phone/stage-phone.cjs', root) : new URL((moved.has(name) ? 'packages/dsh-presentation-protocol/src/' : 'src/client/') + name, root)
