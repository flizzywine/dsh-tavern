import test from 'node:test'
import assert from 'node:assert/strict'
import { FOREGROUND_TOOL_CATALOG, foregroundToolCatalog, normalizeDisabledForegroundTools } from '../tavern-plugin/lib/domain/foreground-tools.js'
import { registerWorldbookFileTools } from '../tavern-plugin/lib/tools/worldbook-files.js'

// 面板只能关闭目录里列出的工具；worldbook_list/grep 与宿主 read 曾漏在目录外，
// 于是「全部关闭」之后模型仍然拿着世界书检索工具。目录必须覆盖正文能看到的可关工具。
test('正文模式的可关工具都在设置目录里：世界书检索与文件读取', () => {
  for (const mode of ['story', 'script']) {
    const names = foregroundToolCatalog(mode).map(tool => tool.name)
    for (const name of ['worldbook_grep', 'worldbook_list', 'read', 'skill', 'tavern_read_variables']) {
      assert.ok(names.includes(name), mode + ' 模式缺少 ' + name)
    }
  }
  const card = foregroundToolCatalog('card').map(tool => tool.name)
  for (const name of ['worldbook_grep', 'worldbook_list', 'read']) assert.equal(card.includes(name), false, '卡片工作台不共用游玩开关')
  assert.equal(new Set(FOREGROUND_TOOL_CATALOG.map(tool => tool.name)).size, FOREGROUND_TOOL_CATALOG.length, '目录不能重名')
  for (const tool of FOREGROUND_TOOL_CATALOG) assert.ok(tool.label && tool.description, tool.name + ' 缺少面板文案')
})

test('「全部关闭」写下的名字能真正压掉世界书检索工具', () => {
  const all = normalizeDisabledForegroundTools(FOREGROUND_TOOL_CATALOG.map(tool => tool.name))
  assert.deepEqual(all, FOREGROUND_TOOL_CATALOG.map(tool => tool.name))
  // 同一份禁用表交给工具白名单过滤：世界书工具不再出现在请求里。
  const offered = ['read', 'worldbook_list', 'worldbook_grep', 'tavern_read_variables', 'skill']
  const disabled = new Set(all)
  assert.deepEqual(offered.filter(name => !disabled.has(name)), [])
})

test('世界书检索工具仍由插件注册，目录只负责开关', () => {
  const registered = []
  registerWorldbookFileTools({ register: tool => registered.push(tool.name) }, {})
  assert.deepEqual(registered, ['worldbook_list', 'worldbook_grep'])
})
