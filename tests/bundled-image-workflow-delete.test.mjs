import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Readable } from 'node:stream'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { deleteWorkflow } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/workflow-delete.js'

const bundledPackage = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled', import.meta.url))

async function pluginRuntime(root, tag) {
  const pluginRoot = path.join(root, 'plugins', 'dsh-tavern-image')
  const routes = new Map(), disposers = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register({ path: routePath, handler }) { routes.set(routePath, handler); return () => routes.delete(routePath) } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const dispose = install(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
  }
  const { apply } = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'index.js')).href + `?runtime=${tag}`)
  apply(ctx)
  return {
    close() { for (const dispose of disposers.splice(0).reverse()) dispose() },
    request(route, body, method = 'POST') {
      return new Promise((resolve, reject) => {
        const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
        Object.assign(req, { method, url: `/plugins/dsh-tavern-image/${route}`, headers: { host: 'localhost', 'content-type': 'application/json' } })
        const response = {
          headersSent: false,
          writeHead(status) { this.status = status; this.headersSent = true },
          end(value) { try { resolve({ status: this.status, body: JSON.parse(String(value)) }) } catch (error) { reject(error) } },
        }
        const handler = routes.get(req.url)
        if (!handler) return reject(new Error(`route not registered: ${req.url}`))
        handler(req, response)
      })
    },
  }
}

async function realRouteFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-image-workflow-route-'))
  const pluginRoot = path.join(root, 'plugins', 'dsh-tavern-image')
  await mkdir(path.dirname(pluginRoot), { recursive: true })
  await cp(bundledPackage, pluginRoot, { recursive: true })
  await mkdir(path.join(pluginRoot, 'workflows'), { recursive: true })
  await writeFile(path.join(pluginRoot, 'worldbook.json'), JSON.stringify({ name: 'test', entries: [] }))
  await writeFile(path.join(pluginRoot, 'definitions.json'), JSON.stringify({ characters: [], settings: [], props: [] }))
  const workflow = name => writeFile(path.join(pluginRoot, 'workflows', name), JSON.stringify({
    format: 'dsh-tavern-comfy-v1', outputNode: '2',
    prompt: {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
    },
    bindings: { positive: [{ node: '1', input: 'text' }] },
  }))
  await workflow('remove-me.json')
  await workflow('fallback.json')
  await writeFile(path.join(pluginRoot, 'config.json'), JSON.stringify({
    defaultWorkflow: 'remove-me',
    workflows: [
      { id: 'remove-me', label: 'Remove me', file: 'workflows/remove-me.json', enabled: true },
      { id: 'fallback', label: 'Fallback', file: 'workflows/fallback.json', enabled: true },
    ],
  }))
  // This fixture edits config.json directly while exercising path migration.
  // Seed the separate tools flag so its startup read never races that deliberate rewrite.
  await writeFile(path.join(pluginRoot, 'card-enabled.json'), JSON.stringify({ enabled: true }))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 200 })
  const run = await pluginRuntime(root, 'first')
  t.after(async () => {
    run.close()
    globalThis.fetch = originalFetch
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())))
    await rm(root, { recursive: true, force: true })
  })
  return { root, pluginRoot, run }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-image-workflow-delete-'))
  const workflowsDir = path.join(root, 'workflows')
  await mkdir(workflowsDir)
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = {
    defaultWorkflow: 'remove-me',
    workflows: [
      { id: 'remove-me', file: 'workflows/remove-me.json' },
      { id: 'fallback', file: 'workflows/fallback.json' },
    ],
  }
  await writeFile(path.join(workflowsDir, 'remove-me.json'), '{"workflow":true}')
  await writeFile(path.join(workflowsDir, 'fallback.json'), '{"workflow":true}')
  const persisted = []
  let reloads = 0
  const deps = {
    config,
    workflowsDir,
    saveConfig: async value => persisted.push(structuredClone(value)),
    reload: async () => { reloads++ },
  }
  return { ...deps, persisted, reloadCount: () => reloads }
}

test('接受指向 workflows 真实目录的 symlink 父目录别名', async t => {
  const f = await fixture(t)
  const aliasDir = path.join(path.dirname(f.workflowsDir), 'workflows-alias')
  await symlink(f.workflowsDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir')
  f.config.workflows[0].file = path.join(aliasDir, 'remove-me.json')

  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 200)
  assert.deepEqual(f.config.workflows.map(item => item.id), ['fallback'])
  assert.deepEqual(await readdir(f.workflowsDir), ['fallback.json'])
})

test('拒绝指向 workflows 外部的 symlink 父目录并保留配置和文件', async t => {
  const f = await fixture(t)
  const outsideDir = path.join(path.dirname(f.workflowsDir), 'outside')
  const aliasDir = path.join(f.workflowsDir, 'outside-alias')
  await mkdir(outsideDir)
  await writeFile(path.join(outsideDir, 'keep.json'), 'keep')
  await symlink(outsideDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir')
  f.config.workflows[0].file = path.join(aliasDir, 'keep.json')

  const result = await deleteWorkflow({ ...f, id: 'remove-me' })
  assert.equal(result.status, 400)
  assert.equal(await readFile(path.join(outsideDir, 'keep.json'), 'utf8'), 'keep')
  assert.deepEqual(f.config.workflows.map(item => item.id), ['remove-me', 'fallback'])
  assert.equal(f.persisted.length, 0)
})

test('实际 POST /workflow 删除文件；reload 和全新 runtime state 都不会重新发现', async t => {
  const f = await realRouteFixture(t)
  const before = await f.run.request('state', undefined, 'GET')
  assert.equal(before.status, 200)
  assert.ok(before.body.workflows.some(item => item.id === 'remove-me'))

  const removed = await f.run.request('workflow', { id: 'remove-me', remove: true })
  assert.equal(removed.status, 200, removed.body.error)
  assert.ok(!removed.body.state.workflows.some(item => item.id === 'remove-me'))
  assert.equal(removed.body.state.workflows.find(item => item.id === 'fallback').current, true)
  await assert.rejects(readFile(path.join(f.pluginRoot, 'workflows', 'remove-me.json')),
    error => error.code === 'ENOENT')
  const savedConfig = JSON.parse(await readFile(path.join(f.pluginRoot, 'config.json'), 'utf8'))
  assert.deepEqual(savedConfig.workflows.map(item => item.id), ['fallback'])

  const rescanned = await f.run.request('reload', {})
  assert.equal(rescanned.status, 200, rescanned.body.error)
  assert.ok(!rescanned.body.state.workflows.some(item => item.id === 'remove-me'))

  f.run.close()
  const restarted = await pluginRuntime(f.root, 'restart')
  t.after(() => restarted.close())
  const afterRestart = await restarted.request('state', undefined, 'GET')
  assert.equal(afterRestart.status, 200)
  assert.ok(!afterRestart.body.workflows.some(item => item.id === 'remove-me'))
  assert.equal(afterRestart.body.workflows.find(item => item.id === 'fallback').current, true)
})

test('实际路由接受 workflows 内的 Windows 绝对反斜杠路径', async t => {
  const f = await realRouteFixture(t)
  const file = path.join(f.pluginRoot, 'workflows', 'remove-me.json')
  const configPath = path.join(f.pluginRoot, 'config.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.workflows[0].file = file
  config.workflows[0].id = 'absolute-old-config'
  await writeFile(configPath, JSON.stringify(config))
  const result = await f.run.request('workflow', { id: 'absolute-old-config', remove: true })
  assert.equal(result.status, 200, result.body.error)
  await assert.rejects(readFile(file), error => error.code === 'ENOENT')
})
