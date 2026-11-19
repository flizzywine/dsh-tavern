import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { importUserHome } from '../bin/import-user-home.mjs'
import { removeTreeSync } from '../bin/portable-fs.mjs'
const put = (root, file, text) => { const target = path.join(root, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, text) }
const get = (root, file) => readFileSync(path.join(root, file), 'utf8')
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-import-'))
  t.after(() => removeTreeSync(root))
  const source = path.join(root, '旧命令行 数据'), target = path.join(root, '官方桌面')
  put(source, 'profiles/tavern/package.json', JSON.stringify({ dshTavern: { host: 'cli' } }))
  put(source, 'profile-data/tavern/data/chats/story.json', '正文与变量')
  put(source, 'profile-data/tavern/sessions/one/events.jsonl', '原生历史')
  put(source, 'profile-data/tavern/data/history/old.json', '历史版本')
  put(source, 'attachments/picture.png', '附件')
  put(source, 'settings.yaml', 'models: old')
  put(source, '.credentials.yaml', 'secret: fixture-only')
  put(source, '.agent-presets/custom.json', '自定义预设')
  put(source, 'profile-data/tavern/data/user-extensions/tools/tool.js', '用户工具')
  put(target, 'settings.yaml', 'models: new')
  return { source, target }
}
test('提交期间目标变化导致回滚，先前已发布项恢复且变化文件保留', t => {
  const f = fixture(t)
  assert.throws(() => importUserHome({ ...f, beforePublish() { put(f.target, 'attachments/picture.png', '并发变动') } }), /目标数据发生变化/)
  assert.equal(existsSync(path.join(f.target, 'profile-data/tavern')), false)
  assert.equal(get(f.target, 'attachments/picture.png'), '并发变动')
  assert.equal(get(f.target, 'settings.yaml'), 'models: new')
})
