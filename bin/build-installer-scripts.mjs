#!/usr/bin/env node
// Standalone installers run before repository modules exist. Keep their shared
// dependency-free helpers embedded verbatim, rather than maintaining forked copies.
//   node bin/build-installer-scripts.mjs          rewrite embedded copies
//   node bin/build-installer-scripts.mjs --check  fail when a copy is stale
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const modules = [
  { file: 'bin/official-desktop-runtime.cjs', targets: [
    { file: 'install.ps1', pattern: /(\$OfficialDesktopModuleSource = @'\n)[\s\S]*?(\n'@\n)/ },
    { file: 'install.sh', pattern: /(<<'DSH_OFFICIAL_DESKTOP_MODULE'\n)[\s\S]*?(\nDSH_OFFICIAL_DESKTOP_MODULE\n)/ },
  ] },
  { file: 'bin/download.cjs', targets: [
    { file: 'install.ps1', pattern: /(\$DownloadModuleSource = @'\n)[\s\S]*?(\n'@\n)/ },
    { file: 'install.sh', pattern: /(<<'DSH_DOWNLOAD_MODULE'\n)[\s\S]*?(\nDSH_DOWNLOAD_MODULE\n)/ },
  ] },
  { file: 'bin/installation-state.cjs', targets: [
    { file: 'install.ps1', pattern: /(\$InstallationStateModuleSource = @'\n)[\s\S]*?(\n'@\n)/ },
    { file: 'install.sh', pattern: /(<<'DSH_INSTALLATION_STATE_MODULE'\n)[\s\S]*?(\nDSH_INSTALLATION_STATE_MODULE\n)/ },
  ] },
]
const readModule = file => readFileSync(new URL(file, root), 'utf8').replaceAll('\r\n', '\n').replace(/\n+$/, '')

export function embedModule(source, pattern, moduleSource) {
  const text = source.replaceAll('\r\n', '\n')
  if (!pattern.test(text)) throw new Error(`embedded module marker not found: ${pattern}`)
  return text.replace(pattern, (_, start, end) => start + moduleSource + end)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const stale = []
  for (const { file: moduleFile, targets } of modules) {
    const moduleSource = readModule(moduleFile)
    for (const { file, pattern } of targets) {
      const url = new URL(file, root)
      const current = readFileSync(url, 'utf8')
      const next = embedModule(current, pattern, moduleSource)
      if (next === current.replaceAll('\r\n', '\n')) continue
      if (check) stale.push(`${file} (${moduleFile})`)
      else { writeFileSync(url, next); console.log(`updated ${file}: ${moduleFile}`) }
    }
  }
  if (stale.length) {
    console.error(`embedded modules are stale in: ${stale.join(', ')}. Run node bin/build-installer-scripts.mjs`)
    process.exitCode = 1
  }
}
