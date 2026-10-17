import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from "node:url"
import { parse } from 'acorn'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = name => readFileSync(path.join(root, name), 'utf8')

test('standard package ships runtime resources without local links, host copies or install scripts', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.deepEqual(manifest.dsh.bundle, { patch: './plugin.patch.yml' })
  assert.equal(manifest.bin, undefined, 'standard installation must not replace the legacy launcher')
  for (const [name, spec] of Object.entries(manifest.dependencies)) {
    assert.ok(!/^(link|file):/.test(spec), `${name} depends on checkout paths`)
    assert.ok(!name.startsWith('@deepseek-ai/'), `${name} would install a second host`)
    assert.notEqual(name, 'node-pty')
  }
  for (const name of ['prepare', 'preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts[name], undefined)
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }))
  const files = new Set(packed.files.map(file => file.path))
  // Splitting the entry must not leave any directly imported runtime module out of the package.
  const entryPath = 'tavern-plugin/lib/index.js'
  for (const node of parse(read(entryPath), { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), node.source.value))
    assert.ok(files.has(target), `entry imports missing runtime module: ${target}`)
  }
  for (const name of [
    'plugin.patch.yml', 'bin/plugin-package-guard.mjs', 'bin/update-diagnostics.mjs',
    'config/dsh-compatibility.json', 'config/plugin-web.LICENSE',
    'tavern-plugin/package.json', 'tavern-plugin/lib/index.js', 'tavern-plugin/lib/client.js',
    'tavern-plugin/lib/user-tools-bridge.js',
    'tavern-plugin/packages/dsh-tavern-card-memory/index.js',
    'tavern-plugin/packages/dsh-tavern-card-memory/package.json',
    'tavern-plugin/packages/dsh-image-gen/src/module.js',
    'tavern-plugin/packages/dsh-tavern-remote/lib/typert.host.js',
    'tavern-plugin/packages/dsh-better-sidebar/lib/client-mermaid.js',
    'tavern-plugin/packages/dsh-dream-skin/lib/index.js',
    'tavern-plugin/packages/dsh-dream-skin/lib/client.js',
    'tavern-plugin/packages/dsh-dream-skin/LICENSE',
    'tavern-plugin/lib/vendor/st-prompt-template/upstream/settings.html',
    'tavern-plugin/lib/vendor/st-prompt-template/server-artifact/engine.js',
    'tavern-plugin/lib/vendor/runtime-assets/jquery/jquery.min.js',
    'tavern-plugin/lib/vendor/runtime-assets/lodash/lodash.min.js',
  ]) assert.ok(files.has(name), `missing runtime resource: ${name}`)
  assert.ok([...files].some(name => name.startsWith('presets/tavern/skills/')))
  assert.ok(![...files].some(name => /(^|\/)(node_modules|tests|docs)\//.test(name)))
  assert.deepEqual([...files].filter(name => name.includes('/upstream/')), ['tavern-plugin/lib/vendor/st-prompt-template/upstream/settings.html'])
  // 0.2.0-rc.2 适配：preset 不再是 presets/ 下的目录（agent.cordis.yml + preset.yml），
  // 而是 bundle patch 里的 @deepseek-ai/dsh-agent-preset 声明行。声明行里 `name` 的解析基准
  // 是声明文件所在目录（profile 目录），相对路径会解析失败，因此这里只允许裸包说明符，
  // 并逐条验证它确实随包发布。
  const pluginPatch = read('tavern-plugin/cordis.patch.yml')
  const presetRows = pluginPatch.split('\n').filter(line => /^\s*name: '@deepseek-ai\/dsh-agent-preset'\s*$/.test(line))
  assert.equal(presetRows.length, 2, 'tavern 与 tavern-background 两个 preset 声明行必须存在')
  for (const [, specifier] of pluginPatch.matchAll(/^\s*name: (\.\.?\/\S+)\s*$/gm)) {
    assert.fail(`preset 声明行不得使用相对路径（0.2.0 的解析基准是 profile 目录）：${specifier}`)
  }
  for (const [, specifier] of pluginPatch.matchAll(/^\s*name: (dsh-tavern-plugin\/\S+)\s*$/gm)) {
    const exported = JSON.parse(read('tavern-plugin/package.json')).exports[`.${specifier.slice('dsh-tavern-plugin'.length)}`]
    assert.ok(exported, `${specifier} 未在 tavern-plugin/package.json 的 exports 中声明`)
    assert.ok(files.has(path.posix.join('tavern-plugin', exported.replace(/^\.\//, ''))), `${specifier} 指向的文件不在发布包内`)
  }
  parse(read('tavern-plugin/lib/client.js'), { ecmaVersion: 'latest', sourceType: 'script' })
})

test('standard bundle and sidebar distribution match their maintained sources', () => {
  execFileSync(process.execPath, ['bin/build-plugin-package.mjs', '--check'], { cwd: root })
  for (const name of ['index.js', 'client.js', 'client-registry.js', 'client-terminal.js', 'client-editor.js', 'client-mermaid.js', 'client-locale.js']) {
    assert.equal(read(`tavern-plugin/packages/dsh-better-sidebar/lib/${name}`), read(`node_modules/dsh-better-sidebar/lib/${name}`))
  }
  assert.match(read('tavern-plugin/packages/dsh-better-sidebar/lib/index.js'), /function threadOwnLogEvents\(/)
})
