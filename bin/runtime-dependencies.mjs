import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// An update can finish with an incomplete node_modules (interrupted or partial
// dependency install) and still pass `dsh --dump-config`, which never imports the
// plugin. The plugin then fails on the next restart ("Cannot find package
// 'jsdom'"). Check that every runtime dependency the repository installs itself
// resolves from the plugin directory, so the installer can fail and roll back.
export function missingRuntimeDependencies(sourceRoot) {
  const manifest = JSON.parse(readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))
  const require = createRequire(path.join(sourceRoot, 'tavern-plugin', 'package.json'))
  const missing = []
  for (const name of Object.keys(manifest.dependencies || {})) {
    try { require.resolve(name) } catch (error) {
      // Present but ESM-only or without a `.` export: resolvable for import(), not for require.
      if (error && (error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || error.code === 'ERR_REQUIRE_ESM')) continue
      missing.push(name)
    }
  }
  return missing
}

export function assertRuntimeDependencies(sourceRoot) {
  const missing = missingRuntimeDependencies(sourceRoot)
  if (missing.length) {
    throw new Error(`依赖未装全，缺少：${missing.join('、')}。插件无法加载，本次安装视为失败。`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertRuntimeDependencies(path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))) }
  catch (error) { console.error(error.message); process.exit(1) }
}
