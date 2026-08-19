import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import './runtime-imports.mjs'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(tmpdir(), 'dsh-tavern-preview')
const profileDir = path.join(runtimeRoot, 'profiles', 'tavern-preview')
const dataRoot = path.join(runtimeRoot, 'data')
const workspaceRoot = path.join(runtimeRoot, 'workspace')
const profilePatchPath = fileURLToPath(new URL('./cordis.patch.yml', import.meta.url))
const publicCardPath = fileURLToPath(new URL('../demo/cards/avra-complete.json', import.meta.url))
const dshBasePatchPath = fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh-base/cordis.patch.yml', import.meta.url))
const dshWebPatchPath = fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml', import.meta.url))

// 这些文件由运行时按目录读取；列出确定路径供 Vercel 静态追踪器收集。
const runtimeAssetPaths = [
  dshBasePatchPath,
  dshWebPatchPath,
  fileURLToPath(new URL('../presets/tavern/agent.cordis.yml', import.meta.url)),
  fileURLToPath(new URL('../presets/tavern/preset.yml', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/candidate-script.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/candidate-story.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/card-editor.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/card-extractor.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/posture-settlement.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/README.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/script-story.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/story.md', import.meta.url)),
  fileURLToPath(new URL('../tavern-plugin/prompts/worldbook-selector.md', import.meta.url)),
]

console.info('[preview] preparing DSH profile')

function linkPackage(name, source) {
  const target = path.join(profileDir, 'node_modules', name)
  mkdirSync(path.dirname(target), { recursive: true })
  if (!existsSync(target)) symlinkSync(source, target, 'dir')
}

function seedPublicDemo() {
  for (const directory of ['cards', 'chats', 'scripts', 'sources', 'diffs']) {
    mkdirSync(path.join(dataRoot, directory), { recursive: true })
  }
  const publicDocument = JSON.parse(readFileSync(publicCardPath, 'utf8'))
  const card = {
    id: 'card-demo',
    ...publicDocument.data,
    spec: publicDocument.spec || 'chara_card_v3',
    importedAt: 0,
    updatedAt: 0,
  }
  writeFileSync(path.join(dataRoot, 'cards', 'card-demo.json'), `${JSON.stringify(card, null, 2)}\n`)
  writeFileSync(path.join(dataRoot, 'index.json'), `${JSON.stringify({
    cards: [{ id: card.id, name: card.name, description: card.description, tags: card.tags, importedAt: card.importedAt }],
    chats: [],
  }, null, 2)}\n`)
  writeFileSync(path.join(dataRoot, 'sessions.json'), '{}\n')
  writeFileSync(path.join(dataRoot, 'settings.json'), '{}\n')
}

process.env.DSH_HOME = runtimeRoot
process.env.DSH_TAVERN_DATA_ROOT = dataRoot
process.env.DSH_TAVERN_PREVIEW = '1'
process.env.DSH_TAVERN_PREVIEW_WORKSPACE = workspaceRoot
process.env.DSH_TELEMETRY_DISABLED = '1'

mkdirSync(profileDir, { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })
mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true })
writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-tavern-preview',
  private: true,
  dependencies: {},
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    },
  },
}, null, 2)}\n`)
for (const assetPath of runtimeAssetPaths) {
  if (!existsSync(assetPath)) throw new Error(`preview runtime asset missing: ${assetPath}`)
}
copyFileSync(profilePatchPath, path.join(profileDir, 'cordis.patch.yml'))
writeFileSync(path.join(profileDir, 'cordis.yml'), '[]\n')
linkPackage('dsh-tavern-plugin', path.join(sourceRoot, 'tavern-plugin'))
linkPackage('dsh-tavern-preview-plugin', path.join(sourceRoot, 'preview-plugin'))

// Vercel 实例的 /tmp 可能被后续请求复用；每次冷启动只带入公开案例。
rmSync(dataRoot, { recursive: true, force: true })
seedPublicDemo()

process.argv = [process.execPath, 'dsh', '--profile', 'tavern-preview']
// 使用字面量导入，让 Vercel 的文件追踪器能够识别并打包 DSH 运行时。
console.info('[preview] starting DSH plugin tree')
try {
  await import('@deepseek-ai/dsh/lib/bin.js')
  console.info('[preview] DSH plugin tree started')
} catch (error) {
  console.error(inspect(error, { depth: null }))
  throw error
}
