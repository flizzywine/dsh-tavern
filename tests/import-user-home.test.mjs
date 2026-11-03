import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertDesktopStopped, importUserHome } from '../bin/import-user-home.mjs'
import { removeTreeSync } from '../bin/portable-fs.mjs'
const put = (root, file, text) => { const target = path.join(root, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, text) }
const get = (root, file) => readFileSync(path.join(root, file), 'utf8')
test('安装前检测带参数的 Windows 和 macOS 桌面主进程', () => {
  for (const command of [
    '"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe" --type=gpu-process',
    'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe --no-sandbox',
    '"C:\\Apps\\DSH Next.exe" --user-data-dir="C:\\Users\\测试 用户\\AppData"',
    '"C:\\Apps\\DSH Desktop.exe"',
    '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness --inspect',
    'DeepSeek Harness',
  ]) assert.throws(() => assertDesktopStopped([], { requireGuiClosed: true, exec: () => command }), /完整退出 DeepSeek Harness/, command)
})
test('普通迁移允许其他桌面，安装检测不把参数中的程序名误判为 GUI', () => {
  for (const command of [
    'node /tmp/install.mjs --app "C:\\Apps\\DeepSeek Harness.exe"',
    '/usr/bin/node /tmp/DeepSeek Harness',
    '"C:\\Apps\\DeepSeek Harness Helper.exe" --type=renderer',
    '"C:\\Apps\\DeepSeek Harness.exe.bak"',
  ]) assert.doesNotThrow(() => assertDesktopStopped([], { requireGuiClosed: true, exec: () => command }))
  assert.doesNotThrow(() => assertDesktopStopped([], { exec: () => '"C:\\Apps\\DeepSeek Harness.exe" --inspect' }))
  const home = path.resolve('/tmp/dsh-home')
  assert.throws(() => assertDesktopStopped([home], { exec: () => `node dsh-desktop-host --profile "${path.join(home, 'profiles/desktop')}"` }), /完整退出使用源目录或目标目录/)
  assert.throws(() => assertDesktopStopped([], { exec() { throw Error('no process access') } }), /无法确认/)
})
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
test('符号链接拒绝，不发布缺失或外链数据', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t)
  symlinkSync('/missing-source-file', path.join(f.source, 'attachments/broken'))
  assert.throws(() => importUserHome(f), /符号链接/)
  assert.equal(get(f.target, 'settings.yaml'), 'models: new')
})
