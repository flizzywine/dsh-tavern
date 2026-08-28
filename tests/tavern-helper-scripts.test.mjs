import assert from 'node:assert/strict'
import test from 'node:test'

import { projectTavernHelperScripts } from '../tavern-plugin/lib/domain/tavern-helper-scripts.js'

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
