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
 test('后台文件工具只注册 read，不开放文件写入、编辑或图片读取', () => {
  const patch = parse(read('tavern-plugin/cordis.patch.yml'), { logLevel: 'silent' })
  const background = patch.flatMap(item => item.insert || []).find(item => item.id === 'preset-tavern-background')
  const rows = background.config.plugins.filter(item => item.name === '@deepseek-ai/dsh-tool-fs')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].config, { read: true, readImage: false, write: false, edit: false })
})
