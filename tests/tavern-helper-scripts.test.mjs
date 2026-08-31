import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'

import { projectTavernHelperScripts } from '../tavern-plugin/lib/domain/tavern-helper-scripts.js'
import { createTavernRemoteAssetPinStore } from '../tavern-plugin/lib/domain/tavern-remote-assets.js'

test('MVUZOD 等别名的远程核心在缓存改写前识别，不下载也不重复运行', async () => {
  for (const name of ['MVUZOD', 'MVU', '变量框架']) {
    const source = [
      { id: 'core', name, type: 'script', enabled: true, content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'" },
      { id: 'schema', name: '变量管理', type: 'script', enabled: true, content: "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js'", data: { initial: 1 } }
    ]
    const original = structuredClone(source)
    const requests = []
    const store = createTavernRemoteAssetPinStore({ fetch: async url => {
      requests.push(String(url))
      return String(url).includes('api.github.com')
        ? { ok: true, json: async () => ({ sha: '0'.repeat(40) }) }
        : { ok: true, headers: { get: () => 'text/javascript' }, text: async () => 'export const registerMvuSchema = () => {}' }
    } })
    // Same order as the production view: pin assets, then select runnable scripts.
    const pinned = await store.pinExtensions({ helperScripts: source, regexScripts: [] })
    const runtime = projectTavernHelperScripts(pinned.helperScripts, { schema: { saved: 2 } })
    assert.deepEqual(runtime.scripts.map(script => script.id), ['schema'], name)
    assert.deepEqual(runtime.scripts[0].data, { saved: 2 })
    assert.match(runtime.scripts[0].content, /\/api\/dsh-tavern\/remote-assets\//)
    assert.equal(requests.some(url => url.includes('MagVarUpdate')), false)
    assert.ok(requests.some(url => url.includes('StageDog')))
    assert.equal(runtime.diagnostics[0].status, 'host-owned')
    assert.deepEqual(source, original)
  }
})

test('已缓存的核心也必须按原始来源过滤，离线不重新下载', async () => {
  const source = { id: 'core', name: 'MVUZOD', type: 'script', enabled: true,
    content: "import 'https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'" }
  const content = 'YAML.parse("hp: 10")'
  const hash = createHash('sha256').update(content).digest('hex')
  const saved = { pins: { 'MagicalAstrogy/MagVarUpdate@HEAD': { commit: '0'.repeat(40) } },
    assets: { ['https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@' + '0'.repeat(40) + '/artifact/bundle.js']: {
      content, hash, path: '/artifact/bundle.js', mediaType: 'text/javascript'
    } } }
  const store = createTavernRemoteAssetPinStore({ readJson: async () => saved,
    fetch: async () => { throw new Error('offline: must not fetch core') } })
  const pinned = await store.pinExtensions({ helperScripts: [source] })
  assert.deepEqual(pinned.helperScripts, [source])
  const result = projectTavernHelperScripts(pinned.helperScripts, {})
  assert.equal(result.scripts.length, 0)
  assert.equal(result.diagnostics[0].status, 'host-owned')
  assert.equal((await store.readCached(hash)).content, content, '保留现有缓存，不删除用户数据')
})

test('人物卡脚本运行清单跳过宿主已接管的 MVU bundle', function () {
  const result = projectTavernHelperScripts([
    { id: 'mvu', name: 'MVU', type: 'script', enabled: true, content: "import 'https://cdn.test/MagicalAstrogy/MagVarUpdate/bundle.js'", data: {} },
    { id: 'worldbook', name: '动态世界书', type: 'script', enabled: true, content: "import 'https://cdn.test/worldbook.js'", data: { auto_apply: true }, buttons: [] }
  ], {})
  assert.deepEqual(result.scripts, [{
    id: 'worldbook', name: '动态世界书', content: "import 'https://cdn.test/worldbook.js'", data: { auto_apply: true }, buttons: [], info: ''
  }])
  assert.deepEqual(result.diagnostics.map(function (item) { return item.status }), ['host-owned'])
})

test('已持久化的脚本变量覆盖人物卡初始配置但不修改来源', function () {
  const source = [{ id: 'worldbook', name: '动态世界书', type: 'script', enabled: true, content: 'void 0', data: { auto_apply: true } }]
  const result = projectTavernHelperScripts(source, { worldbook: { auto_apply: false } })
  assert.deepEqual(result.scripts[0].data, { auto_apply: false })
  result.scripts[0].data.auto_apply = true
  assert.equal(source[0].data.auto_apply, true)
})

test('普通启用脚本可独立于 MVU 运行，禁用脚本及卡片编辑模式不执行', async () => {
  const { hasTavernScriptRuntime } = await import('../tavern-plugin/lib/domain/tavern-helper-scripts.js')
  const chat = { cardPath: 'card.json', mode: 'story', mvu: { enabled: false } }
  const script = { id: 'plain', type: 'script', enabled: true, content: 'void 0' }
  assert.equal(hasTavernScriptRuntime(chat, [script]), true)
  assert.equal(hasTavernScriptRuntime(chat, [{ ...script, enabled: false }]), false)
  assert.equal(hasTavernScriptRuntime({ ...chat, mode: 'card' }, [script]), false)
  assert.equal(hasTavernScriptRuntime({ ...chat, mvu: { enabled: true } }, []), true)
})
