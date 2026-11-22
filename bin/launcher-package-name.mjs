import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// DSH resolves the bundle's host and browser entries by the installed package name.
export function setLauncherPackageName(directory, currentName, name) {
  for (const [file, entry] of [
    ['package.json', `"name": "${currentName}"`],
    ['cordis.patch.yml', `name: '${currentName}'`],
    ['client.js', `id: '${currentName}'`],
  ]) {
    const target = join(directory, file)
    const contents = readFileSync(target, 'utf8')
    if (!contents.includes(entry)) throw Error(`切换组件源缺少入口：${file}`)
    writeFileSync(target, contents.replace(entry, entry.replace(currentName, name)))
  }
}
