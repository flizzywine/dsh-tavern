// The real sibling sources the stage client build reads from a plugin tree: each mod's stage client (mods/) and the whole
// protocol src folder it inlines from (stage-entrance, card-stage-mode, tts-messages, ...). Copied whole rather than by a
// hand-kept list, so a fixture cannot drift from what the build reads (tts-messages.cjs since a2f0329c4).
import { cp } from 'node:fs/promises'
import path from 'node:path'

const plugin = new URL('../../tavern-plugin/', import.meta.url)

export async function copyStageBuildSiblings(pluginRoot) {
  await cp(new URL('mods/', plugin), path.join(pluginRoot, 'mods'), { recursive: true })
  await cp(new URL('packages/dsh-presentation-protocol/src/', plugin), path.join(pluginRoot, 'packages/dsh-presentation-protocol/src'), { recursive: true })
}
