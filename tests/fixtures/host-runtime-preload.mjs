import Module, { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

// Route both ESM imports and createRequire through the selected host. Old local
// plugin dependencies must not shadow the desktop packages being tested.
if (process.env.DSH_BOOT_MODULE) {
  const hostRequire = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const sourceRoot = new URL('../../', import.meta.url).href
  let resolvingHost = false
  function selectedHostPath(specifier, parentURL) {
    if (!specifier.startsWith('@deepseek-ai/') || resolvingHost || !parentURL?.startsWith(sourceRoot)) return
    resolvingHost = true
    try { return hostRequire.resolve(specifier) } finally { resolvingHost = false }
  }
  registerHooks({ resolve(specifier, context, nextResolve) {
    // Explicit package probes anchored in a synthetic installation must still
    // inspect that installation, rather than being redirected to the real host.
    const selected = selectedHostPath(specifier, context.parentURL)
    return selected ? { url: pathToFileURL(selected).href, shortCircuit: true } : nextResolve(specifier, context)
  } })
  // Node 22 routes require() through registerHooks, but may bypass it for
  // require.resolve(). Apply the same source-scoped lookup on that test host.
  let usesResolveHook = false
  try {
    usesResolveHook = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-app-boot') === hostRequire.resolve('@deepseek-ai/dsh-app-boot')
  } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
  if (!usesResolveHook) {
    const resolveFilename = Module._resolveFilename
    Module._resolveFilename = function (specifier, parent, ...args) {
      const parentURL = parent?.filename ? pathToFileURL(parent.filename).href : undefined
      return selectedHostPath(specifier, parentURL) ?? resolveFilename.call(this, specifier, parent, ...args)
    }
  }
}
