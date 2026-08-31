import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

const manifestUrl = import.meta.resolve('dsh-web-mobile/package.json')
const manifest = JSON.parse(await readFile(new URL(manifestUrl), 'utf8'))

test('新版移动端包、bundle 与浏览器模块使用同一个新名称', async () => {
  assert.equal(manifest.name, 'dsh-web-mobile')
  assert.equal(manifest.version, '2.3.0')
  const patch = parse(await readFile(new URL(manifest.dsh.bundle.patch, manifestUrl), 'utf8'))
  assert.equal(patch[0].insert.length, 1)
  assert.equal(patch[0].insert[0].name, manifest.name)
  assert.equal(patch[0].insert[0].id, manifest.name)
  let descriptor
  vm.runInNewContext(await readFile(new URL(manifest.exports['./client'].default, manifestUrl), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { descriptor = value } } },
  })
  assert.equal(descriptor.id, manifest.name)
  assert.equal(typeof descriptor.factory, 'function')
})

test('真实 DSH 可挂载并卸载新版移动端插件，不启动服务或请求模型', { skip: !process.env.DSH_BOOT_MODULE }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-mobile-boot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = path.join(root, 'host.yml')
  await writeFile(config, `- id: dsh-web-mobile\n  name: ${import.meta.resolve('dsh-web-mobile')}\n`)
  const { boot } = await import(pathToFileURL(process.env.DSH_BOOT_MODULE).href)
  const ctx = await boot('tavern-mobile-test', config)
  await ctx.fiber.dispose()
})
