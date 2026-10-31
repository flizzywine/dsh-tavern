import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { assembleTavernClient } from '../bin/build-tavern-client.mjs'

test('完整客户端必须可解析，局部源码测试不能代替入口语法检查', async () => {
  const source = await assembleTavernClient()
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'tavern-plugin/lib/client.js' }))
})

for (const check of [false, true]) {
  test(`客户端 ${check ? '--check' : 'build'} 拒绝非法语法且保留现有产物`, async t => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'tavern-client-build-')))
    t.after(() => rm(root, { recursive: true, force: true }))
    const builder = path.join(root, 'bin/build-tavern-client.mjs')
    const template = path.join(root, 'tavern-plugin/src/client/main.js')
    const output = path.join(root, 'tavern-plugin/lib/client.js')
    for (const directory of ['bin/lib', 'tavern-plugin/src/client', 'tavern-plugin/lib/client-assets']) {
      await mkdir(path.join(root, directory), { recursive: true })
    }
    await copyFile(new URL('../bin/build-tavern-client.mjs', import.meta.url), builder)
    await copyFile(new URL('../bin/build-interface-skin-client.mjs', import.meta.url), path.join(root, 'bin/build-interface-skin-client.mjs'))
    const skin = path.join(root, 'tavern-plugin/packages/dsh-dream-skin')
    await cp(new URL('../tavern-plugin/packages/dsh-dream-skin/src/', import.meta.url), path.join(skin, 'src'), {recursive:true})
    await mkdir(path.join(skin, 'lib'), {recursive:true})
    await copyFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/client.js', import.meta.url), path.join(skin, 'lib/client.js'))
    const stage = path.join(root, 'tavern-plugin/packages/dsh-tavern-stage/lib/client')
    await mkdir(stage, {recursive:true})
    await copyFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/runtime-kernel.cjs', import.meta.url), path.join(stage, 'runtime-kernel.cjs'))
    await copyFile(new URL('../bin/lib/client-export-guard.mjs', import.meta.url), path.join(root, 'bin/lib/client-export-guard.mjs'))
    await copyFile(new URL('../bin/lib/css-syntax-guard.mjs', import.meta.url), path.join(root, 'bin/lib/css-syntax-guard.mjs'))
    // The fixture includes every required inert builder input.
    for (const name of ['surfaces.cjs', ...['motion', 'phase', 'timing', 'script', 'player'].map(part => 'skin-overlay-' + part + '.cjs')]) {
      await copyFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), path.join(root, 'tavern-plugin/src/client', name))
    }
    for (const name of ['tavern.css', 'theme.css', 'layered-sprite.css', 'phone.css', 'mod-config.css', 'textcard.css']) await writeFile(path.join(root, 'tavern-plugin/lib/client-assets', name), '')
    await mkdir(path.join(root, 'tavern-plugin/shared'), { recursive: true })
    await writeFile(path.join(root, 'tavern-plugin/shared/keyword-catalogue.cjs'), 'module.exports = {};')
    // The copied builder imports its dependencies (acorn) by package name. Windows needs a privilege to make
    // symlinks; there the test runner's resolve hook finds the packages instead.
    if (process.platform !== 'win32') await symlink(new URL('../node_modules', import.meta.url).pathname, path.join(root, 'node_modules'), 'dir')
    for (const name of ['logo', 'lockup', 'lockup-dark']) await writeFile(path.join(root, `tavern-plugin/lib/client-assets/${name}.svg`), '<svg/>')
    const valid = '// @include-stage runtime-kernel.cjs\nconst fixture = 1;\n'
    const invalid = 'const = 1;\n'
    await writeFile(template, valid)
    const build = args => spawnSync(process.execPath, [builder, ...args], { encoding: 'utf8', timeout: 10000 })
    const initial = build([])
    assert.ifError(initial.error)
    assert.equal(initial.status, 0, initial.stderr)
    let previous = await readFile(output, 'utf8')
    assert.ok(previous.includes('function createStageRuntimeKernel('))
    assert.ok(previous.includes('const fixture = 1;'))
    await writeFile(template, invalid)
    if (check) {
      // Keep source and output in sync so an outdated-output error cannot pass this test.
      previous = previous.replace('const fixture = 1;', invalid)
      await writeFile(output, previous)
    }
    const result = build(check ? ['--check'] : [])
    assert.ifError(result.error)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /Unexpected token/)
    assert.equal(await readFile(output, 'utf8'), previous)
  })
}
