import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Deliberately explicit: never download or advance the fixed host baseline.
const root = fileURLToPath(new URL('../', import.meta.url))
const hostRoot = process.argv[process.argv.indexOf('--host-root') + 1]
if (!process.argv.includes('--host-root') || !hostRoot) throw new Error('用法：node bin/vendor-plugin-package.mjs --host-root /path/to/dsh/node_modules')
const policy = JSON.parse(readFileSync(path.join(root, 'config/dsh-compatibility.json'), 'utf8'))
const web = path.join(path.resolve(hostRoot), '@deepseek-ai/dsh-web-app')
if (JSON.parse(readFileSync(path.join(web, 'package.json'), 'utf8')).version !== policy.adaptedDshVersion) throw new Error('Web bundle 版本与固定宿主不符')

const sidebar = path.join(root, 'node_modules/dsh-better-sidebar')
const pkg = JSON.parse(readFileSync(path.join(sidebar, 'package.json'), 'utf8'))
if (pkg.version !== JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies['dsh-better-sidebar']) throw new Error('侧栏版本与现有兼容补丁不符')
const hostCode = readFileSync(path.join(sidebar, 'lib/index.js'), 'utf8')
if (!hostCode.includes('function threadOwnLogEvents(') || !hostCode.includes('session/end-seed')) throw new Error('侧栏尚未应用 Tavern 的兼容补丁，请先 pnpm install --frozen-lockfile')

writeFileSync(path.join(root, 'config/plugin-web.patch.yml'), `# Vendored from @deepseek-ai/dsh-web-app ${policy.adaptedDshVersion} (MIT).\n# Fixed Tavern host baseline; refresh only with an explicit compatibility upgrade.\n` + readFileSync(path.join(web, 'cordis.patch.yml'), 'utf8'))
copyFileSync(path.join(web, 'LICENSE'), path.join(root, 'config/plugin-web.LICENSE'))
const target = path.join(root, 'tavern-plugin/packages/dsh-better-sidebar')
mkdirSync(path.join(target, 'lib'), { recursive: true })
for (const name of ['index.js', 'client.js', 'client-registry.js', 'client-terminal.js', 'client-editor.js', 'client-mermaid.js', 'client-locale.js']) {
  copyFileSync(path.join(sidebar, 'lib', name), path.join(target, 'lib', name))
}
copyFileSync(path.join(sidebar, 'LICENSE'), path.join(target, 'LICENSE'))
const manifest = Object.fromEntries(['name', 'version', 'type', 'main', 'dsh'].map(key => [key, pkg[key]]))
manifest.private = true
manifest.exports = { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' }
writeFileSync(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
await import('./build-plugin-package.mjs')
