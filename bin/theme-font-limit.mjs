import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { adaptedDshVersion } from './dsh-compatibility.mjs'

// DSH 0.2.1 centralizes each font role's schema, controls and validation in
// FONT_SIZE_SPECS. Raise only the text role; code and terminal keep host limits.
const textSpec = indent => `variable: "--dsh-content-font-size",\n${indent}min: 10,\n${indent}max: 22,`
const replacements = {
  'index.js': [
    ['const FONT_SIZE_MAX = 22;', 'const FONT_SIZE_MAX = 32;'],
    [textSpec('\t\t'), textSpec('\t\t').replace('max: 22,', 'max: 32,')],
  ],
  'client.js': [
    [textSpec('\t\t\t\t'), textSpec('\t\t\t\t').replace('max: 22,', 'max: 32,')],
  ],
}

export function patchThemeFontLimit(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  // 0.2.0-rc.2 适配：版本闸跟随 config/dsh-compatibility.json 的 adaptedDshVersion，
  // 不再写死 0.1.5-rc.2——写死会让 0.2.0 宿主抛错，被 profile-installation.mjs:305-308
  // 捕获后 rollback 整个安装。
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-theme' || manifest.version !== adaptedDshVersion) {
    throw new Error(`字号补丁仅适用于 dsh-client-ui-theme ${adaptedDshVersion}`)
  }
  // Validate every anchor before writing; repeated installation is a no-op.
  const changes = Object.entries(replacements).map(([name, pairs]) => {
    const file = path.join(directory, 'lib', name)
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of pairs) {
      if (after.split(from).length === 2 && !after.includes(to)) after = after.replace(from, to)
      else if (after.includes(from) || after.split(to).length !== 2) throw new Error(`字号补丁不匹配：${name}；未修改文件`)
    }
    return { file, before, after }
  }).filter(change => change.before !== change.after)
  const written = []
  try {
    for (const change of changes) {
      written.push(change)
      writeFileSync(change.file, change.after)
    }
  } catch (error) {
    for (const change of written.reverse()) writeFileSync(change.file, change.before)
    throw error
  }
  return changes.length > 0
}
