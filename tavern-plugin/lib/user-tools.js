import { pathToFileURL } from 'node:url'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { ensureUserExtensions } from './domain/user-extensions.js'

export const inject = ['loader']

// Native include intentionally leaves group config expressions unevaluated.
// Resolve the user path here, then delegate loading/lifecycle to DSH itself.
export async function apply(ctx) {
  const paths = await ensureUserExtensions(resolveTavernDataRoot())
  await ctx.plugin(ctx.loader.builtins.include, { path: pathToFileURL(paths.config).href })
}
