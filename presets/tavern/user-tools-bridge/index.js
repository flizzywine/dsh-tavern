import { pathToFileURL } from 'node:url'
import { resolveTavernDataRoot } from '../../../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions } from '../../../tavern-plugin/lib/domain/user-extensions.js'

export const inject = ['loader']

// Keep this Loader source in its own package. Request/package inventories must
// not mistake the bridge for a second active dsh-tavern-plugin installation.
export async function apply(ctx) {
  const paths = await ensureUserExtensions(resolveTavernDataRoot())
  await ctx.plugin(ctx.loader.builtins.include, { path: pathToFileURL(paths.config).href })
}
