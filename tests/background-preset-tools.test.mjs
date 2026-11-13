import { parse } from 'yaml'
// 后台预设必须声明 background-agent-task.js 里 restrict({allow}) 会点名的全局工具。
// 0.2.0 的 tools.restrict() 会校验 allow/deny 里的名字都已注册，缺一行就让整个
// 后台任务（MVU 结算、世界书过滤）失败——这是真实踩过的坑：后台 preset 漏了 tool-web，
// 结算任务报 `tools.restrict() names unknown global tool "web_search"`，变量不更新。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = name => readFileSync(path.join(root, name), 'utf8')

// 解析 preset 声明行：`- id: preset-<name>` 之下缩进的插件行。
// 只认 `name: '<包名>'` 形态的行，`cordis:group` 子行不带包名。
function presetPlugins(patch, presetId) {
  const lines = patch.split('\n')
  const start = lines.findIndex(line => line.trim() === `- id: ${presetId}`)
  assert.notEqual(start, -1, `patch 里找不到声明行 ${presetId}`)
  const names = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s{4}- id: /.test(line)) break // 下一个顶层 insert 条目
    const match = /^\s*- id: (\S+)\s*$/.exec(line)
    if (!match) continue
    const next = lines[index + 1] || ''
    const specifier = /^\s*name: '?([^'\n]+?)'?\s*$/.exec(next)?.[1]
    names.push({ id: match[1], specifier })
  }
  return names
}

test('tavern-background 预设声明了后台任务 restrict 会点名的全部工具', () => {
  const patch = read('tavern-plugin/cordis.patch.yml')
  const background = presetPlugins(patch, 'preset-tavern-background')
  const declared = new Set(background.map(row => row.specifier))

  // background-agent-task.js 的 restrict allow 列表里点名了外部全局工具（不是插件自注册的）。
  // 解析源码避免复制粘贴：读那一行的数组字面量，取其中的裸名字。
  const task = read('tavern-plugin/lib/background-agent-task.js')
  const allowLine = task.split('\n').find(line => line.includes('childCtx.tools.restrict({ allow:'))
  assert.ok(allowLine, 'background-agent-task.js 的 restrict 调用行已改名，请同步本测试')
  const names = [...allowLine.matchAll(/'([a-z][a-z0-9_]*)'/g)].map(match => match[1])
  assert.ok(names.length > 0, '没解析出 allow 列表里的工具名')

  // 每个点名都必须在后台预设里有对应的宿主工具行。
  const hostToolRowFor = {
    skill: '@deepseek-ai/dsh-tool-skill',
    read: '@deepseek-ai/dsh-tool-fs',
    web_fetch: '@deepseek-ai/dsh-tool-web',
    web_search: '@deepseek-ai/dsh-tool-web',
  }
  for (const name of names) {
    const specifier = hostToolRowFor[name]
    if (specifier === undefined) {
      assert.ok(['tavern_read_skill_reference', 'worldbook_list', 'worldbook_grep'].includes(name), `未校验的后台工具：${name}，必须补充注册来源` )
      continue
    }
    assert.ok(declared.has(specifier), `tavern-background 预设缺少 ${specifier}（后台任务会 restrict 到未注册的 "${name}"）`)
  }
})

test('tavern 与 tavern-background 预设各自的 tool-web 行都只开 search 不开 fetch', () => {
  const patch = read('tavern-plugin/cordis.patch.yml')
  const lines = patch.split('\n')
  for (const presetId of ['preset-tavern', 'preset-tavern-background']) {
    const rows = presetPlugins(patch, presetId).filter(row => row.specifier === '@deepseek-ai/dsh-tool-web')
    assert.equal(rows.length, 1, `${presetId} 必须恰好声明一行 tool-web`)
    const start = lines.findIndex(line => line.trim() === '- id: tool-web')
    // 只取本 preset 的那一段：从 tool-web 行往后读到下一个 `- id:` 行。
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\s*- id: /.test(lines[index])) { end = index; break }
    }
    const block = lines.slice(start, end).join('\n')
    assert.match(block, /search: true/, `${presetId} 的 tool-web 必须开启 search`)
    assert.match(block, /fetch: false/, `${presetId} 的 tool-web 必须关闭 fetch`)
  }
})

 test('后台文件工具只注册 read，不开放文件写入、编辑或图片读取', () => {
  const patch = parse(read('tavern-plugin/cordis.patch.yml'), { logLevel: 'silent' })
  const background = patch.flatMap(item => item.insert || []).find(item => item.id === 'preset-tavern-background')
  const rows = background.config.plugins.filter(item => item.name === '@deepseek-ai/dsh-tool-fs')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].config, { read: true, readImage: false, write: false, edit: false })
})
