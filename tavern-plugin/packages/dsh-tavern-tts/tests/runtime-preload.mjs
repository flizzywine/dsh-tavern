// Test-only, read-only Windows/runtime resolution. Never patches the runtime.
import Module, { registerHooks, createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve, join } from 'node:path'
const parentURL = process.env.DSH_BOOT_MODULE && pathToFileURL(process.env.DSH_BOOT_MODULE).href
// Browser fixtures need the real React distribution, not DSH's runtime bridge.
const dependencyRoot = process.env.TTS_TEST_DEPENDENCY_ROOT || resolve(dirname(process.env.DSH_BOOT_MODULE), '../../../../../../..')
const rootRequire = createRequire(join(dependencyRoot,'package.json')), original = Module._resolveFilename
let resolving = false
Module._resolveFilename = function(request, parent, isMain, options) {
  if (!resolving && /^(react|react-dom|scheduler)(\/|$)/.test(request)) {
    resolving = true
    try { return rootRequire.resolve(request) } finally { resolving = false }
  }
  return original.call(this,request,parent,isMain,options)
}
registerHooks({ resolve(specifier, context, next) {
  if (/^[A-Za-z]:[\\/]/.test(specifier) && context.conditions.includes('import')) return next(pathToFileURL(specifier).href,context)
  if (!context.conditions.includes('require') && /^(react|react-dom|scheduler)(\/|$)/.test(specifier)) {
    return next(specifier,{...context,parentURL:pathToFileURL(join(dependencyRoot,'package.json')).href})
  }
  if (parentURL && specifier.startsWith('@deepseek-ai/')) {
    try { return next(specifier,{...context,parentURL}) } catch {}
  }
  return next(specifier,context)
} })
