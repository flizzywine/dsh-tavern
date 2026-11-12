import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// 素材原样: Tavern's asset pictures (人设图, 立绘, 服装设定图, tavern.generateImage) send their prompt as written. From 3.15
// the 配图 plugin adds the selected 画风预设 to every generate() that names none, and has no "none"; a request can name a
// registered preset instead (README「登记画风预设」, its public `./modules` export). This one is empty, so the prompt goes
// out unchanged, as it did before 3.15. The plugin runs in this process from its folder, so importing that folder's
// `./modules` export reaches the registry it reads. A plugin without that export (3.12 and older) applies no preset.
export const ASSET_PROMPT_PRESET = 'dsh-tavern.asset'
const IMAGE_PLUGIN = 'dsh-tavern-image'

/** () => the preset id to pass to the image plugin's generate(), registering it once per plugin folder; undefined when
 *  the running image plugin takes no presets. */
export function assetPromptPreset({ pluginsDir, running, importModule = specifier => import(specifier) }) {
  let registered = null
  return async () => {
    const identity = running.get(IMAGE_PLUGIN)
    if (!identity) return undefined
    const dir = path.join(pluginsDir, identity.folder)
    if (registered === dir) return ASSET_PROMPT_PRESET
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    const entry = pkg.exports?.['./modules']?.default ?? pkg.exports?.['./modules']
    if (typeof entry !== 'string') return undefined
    const { registerPromptPreset } = await importModule(pathToFileURL(path.join(dir, entry)).href)
    registerPromptPreset({ id: ASSET_PROMPT_PRESET, name: '素材原样', source: 'DSH Tavern' })
    registered = dir
    return ASSET_PROMPT_PRESET
  }
}
