// Optional offline preparation. Does not change skin selections or delete existing fonts.
import { FONT_CATALOG, createFontAssets } from '../tavern-plugin/packages/dsh-dream-skin/lib/font-assets.js'
import { resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
const assets = createFontAssets({ dataRoot: resolveTavernDataRoot() })
let failed = 0
for (const family of FONT_CATALOG.families) for (const face of family.files) {
  try { await assets.ensure(family.id, face.file); console.log(`Ready: ${family.label} ${face.weight}`) }
  catch { failed++; console.error(`Unavailable: ${family.label} ${face.weight}; cached fonts remain usable`) }
}
if (failed) process.exitCode = 1
