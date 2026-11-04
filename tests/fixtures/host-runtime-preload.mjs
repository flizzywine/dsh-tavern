import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

// Route both ESM imports and createRequire through the selected host. Old local
// plugin dependencies must not shadow the desktop packages being tested.
if (process.env.DSH_BOOT_MODULE) {
  const hostRequire = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  const sourceRoot = new URL('../../', import.meta.url).href
  let resolvingHost = false
  registerHooks({ resolve(specifier, context, nextResolve) {
    // Explicit package probes anchored in a synthetic installation must still
    // inspect that installation, rather than being redirected to the real host.
    if (!specifier.startsWith('@deepseek-ai/') || resolvingHost || !context.parentURL?.startsWith(sourceRoot)) return nextResolve(specifier, context)
    // CJS resolution keeps a Module parent; changing only parentURL does not
    // change createRequire's search paths. Resolve through the actual host.
    resolvingHost = true
    try { return { url: pathToFileURL(hostRequire.resolve(specifier)).href, shortCircuit: true } }
    finally { resolvingHost = false }
  } })
}
