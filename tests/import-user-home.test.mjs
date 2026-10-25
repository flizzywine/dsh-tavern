import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync, renameSync } from 'node:fs'
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
test('完整继承用户数据，保留双方配置备份，重跑不覆盖新进度', t => {
  const f = fixture(t), result = importUserHome(f)
  for (const file of ['profile-data/tavern/data/chats/story.json', 'profile-data/tavern/sessions/one/events.jsonl', 'profile-data/tavern/data/history/old.json', 'attachments/picture.png', '.agent-presets/custom.json', '.credentials.yaml', 'profile-data/tavern/data/user-extensions/tools/tool.js']) assert.equal(get(f.target, file), get(f.source, file))
  assert.equal(get(result.backup, 'target/settings.yaml'), 'models: new')
  assert.equal(get(result.backup, 'source/settings.yaml'), 'models: old')
  assert.equal(get(f.target, 'settings.yaml'), 'models: old')
  put(f.target, 'profile-data/tavern/data/chats/story.json', '测试版新进度')
  assert.equal(importUserHome(f).alreadyImported, true)
  assert.equal(get(f.target, 'profile-data/tavern/data/chats/story.json'), '测试版新进度')
  assert.equal(get(f.source, 'profile-data/tavern/data/chats/story.json'), '正文与变量')
})
test('相同文件与无冲突数据可共存，同名不同存档停止且双方备份可读', t => {
  const f = fixture(t)
  put(f.target, 'profile-data/tavern/data/chats/story.json', '另一份正文')
  assert.throws(() => importUserHome(f), /同名存档/)
  assert.equal(get(f.target, 'settings.yaml'), 'models: new')
  assert.equal(get(f.target, 'profile-data/tavern/data/chats/story.json'), '另一份正文')
  const reports = path.join(f.target, 'backups/tavern-home-import')
  const report = JSON.parse(get(reports, readdirSync(reports).find(name => name.endsWith('.json'))))
  assert.equal(get(report.backup, 'source/profile-data/tavern/data/chats/story.json'), '正文与变量')
  assert.equal(get(report.backup, 'target/profile-data/tavern/data/chats/story.json'), '另一份正文')
})
test('提交期间目标变化导致回滚，先前已发布项恢复且变化文件保留', t => {
  const f = fixture(t)
  assert.throws(() => importUserHome({ ...f, beforePublish() { put(f.target, 'attachments/picture.png', '并发变动') } }), /目标数据发生变化/)
  assert.equal(existsSync(path.join(f.target, 'profile-data/tavern')), false)
  assert.equal(get(f.target, 'attachments/picture.png'), '并发变动')
  assert.equal(get(f.target, 'settings.yaml'), 'models: new')
})
test('源目录变化停止提交，旧服务运行和嵌套路径均拒绝', t => {
  const f = fixture(t)
  assert.throws(() => importUserHome({ ...f, beforePublish() { put(f.source, 'profile-data/tavern/data/chats/story.json', '正在写入') } }), /源数据发生变化/)
  assert.equal(get(f.target, 'settings.yaml'), 'models: new')
  put(f.source, 'logs/tavern.pid.json', JSON.stringify({ pid: process.pid }))
  assert.throws(() => importUserHome(f), /停止旧命令行/)
  assert.throws(() => importUserHome({ source: f.source, target: path.join(f.source, 'nested') }), /互相包含/)
  assert.equal(existsSync(path.join(f.source, 'nested')), false)
})
test('旧自定义安装的程序旁 data 目录完整进入固定数据目录', t => {
  const f = fixture(t), checkout = path.join(f.source, 'old-program')
  put(checkout, 'data/cards/card.json', '旧卡')
  put(checkout, 'data/chats/story.json', '正文与变量')
  put(f.source, 'profiles/tavern/package.json', JSON.stringify({ dshTavern: { source: checkout } }))
  const result = importUserHome(f)
  assert.equal(get(f.target, 'profile-data/tavern/data/cards/card.json'), '旧卡')
  assert.equal(get(result.backup, 'legacy-data/cards/card.json'), '旧卡')
})
test('中断发布的记录在重试时恢复，保留中断时的数据后完成继承', t => {
  const f = fixture(t), result = importUserHome(f)
  const reports = path.join(f.target, 'backups/tavern-home-import')
  const file = path.join(reports, readdirSync(reports).find(name => name.endsWith('.json')))
  result.phase = 'publishing'
  writeFileSync(file, JSON.stringify(result))
  const retried = importUserHome(f)
  assert.equal(retried.phase, 'completed')
  assert.equal(get(f.target, 'settings.yaml'), 'models: old')
  assert.ok(readdirSync(result.backup).some(name => name.startsWith('interrupted-')))
})
test('符号链接拒绝，不发布缺失或外链数据', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t)
  symlinkSync('/missing-source-file', path.join(f.source, 'attachments/broken'))
  assert.throws(() => importUserHome(f), /符号链接/)
  assert.equal(get(f.target, 'settings.yaml'), 'models: new')
})
