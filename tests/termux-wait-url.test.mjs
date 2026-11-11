import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const bash = process.env.TEST_BASH || 'bash'
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)

// 启动等待脚本写在 termux-tavern.sh 的 heredoc 里；抽出来单独跑，就能在没有
// proot/Termux 的机器上验证「只认当前进程的 token」这条规则。
const shell = await readFile(path.join(root, 'scripts/termux/termux-tavern.sh'), 'utf8')
const lines = shell.split('\n')
const begin = lines.findIndex(line => line.includes("<<'WAIT_EOF'"))
const finish = lines.findIndex((line, index) => index > begin && line.trim() === 'WAIT_EOF')
assert.ok(begin > 0 && finish > begin, 'termux-tavern.sh 里找不到等待脚本 heredoc')
const waitSource = lines.slice(begin + 1, finish).join('\n')

// 只认 `?token=fresh` 的地址：换到 cookie 是 303，历史 token 一律 401。
function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://dsh.invalid')
    if (url.pathname === '/' && url.searchParams.get('token') === 'fresh') {
      response.writeHead(303, { location: './' })
      response.end()
      return
    }
    response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

async function createHome(directory, port) {
  const home = path.join(directory, 'home')
  await mkdir(path.join(home, '.dsh-tavern', 'logs'), { recursive: true })
  const log = path.join(home, '.dsh-tavern', 'logs', 'tavern.log')
  const script = path.join(directory, 'tavern-wait.sh')
  const body = waitSource
    .replaceAll('127.0.0.1:3081', `127.0.0.1:${port}`)
    .replaceAll('127.0.0.1/3081', `127.0.0.1/${port}`)
    // 上限压到 4 秒，失败场景不必真等 300 秒。
    .replaceAll('$i -lt 300', '$i -lt 4')
    // 这里只验证取址逻辑：不跟随日志，避免测试进程被 tail -F 拖住。
    .replace(/^tail -n 0 -F .*$/mu, ':')
    .replace('TPID=$!', 'TPID=')
    .replaceAll('kill "$TPID" 2>/dev/null || true', ':')
  await writeFile(script, body)
  return { home, log, script }
}

function runWait(script, home, onSpawn) {
  const child = spawn(bash, [shellPath(script)], {
    env: { ...process.env, HOME: shellPath(home) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  onSpawn?.(child)
  return new Promise(resolve => child.on('exit', status => resolve({ status, stdout: stdout.trim(), stderr })))
}

test('历史 token 不再被当成本次启动的地址', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-wait-'))
  const { server, port } = await startServer()
  try {
    const { home, log, script } = await createHome(directory, port)
    await writeFile(log, `dsh web: http://127.0.0.1:${port}/?token=oldtoken\n`)
    const result = await runWait(script, home)
    assert.equal(result.status, 1, '没有新地址时必须失败退出')
    assert.equal(result.stdout, '', '不能把日志里的历史 token 当结果交出去')
    assert.match(result.stderr, /没拿到本次启动的地址/)
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('等本次启动新增的地址行出现后再返回', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-wait-'))
  const { server, port } = await startServer()
  try {
    const { home, log, script } = await createHome(directory, port)
    await writeFile(log, `dsh web: http://127.0.0.1:${port}/?token=oldtoken\n`)
    // 模拟端口先通、地址行过一秒才落盘。
    const result = await runWait(script, home, () => {
      setTimeout(() => { appendFile(log, `dsh web: http://127.0.0.1:${port}/?token=fresh\n`) }, 1000)
    })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, `http://127.0.0.1:${port}/?token=fresh`)
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('服务已在运行时沿用日志里仍然有效的 token', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-wait-'))
  const { server, port } = await startServer()
  try {
    const { home, log, script } = await createHome(directory, port)
    await writeFile(log, `dsh web: http://127.0.0.1:${port}/?token=oldtoken\ndsh web: http://127.0.0.1:${port}/?token=fresh\n`)
    const result = await runWait(script, home)
    assert.equal(result.status, 0)
    assert.equal(result.stdout, `http://127.0.0.1:${port}/?token=fresh`)
    assert.match(result.stderr, /服务已在运行/)
  } finally {
    server.close()
    await rm(directory, { recursive: true, force: true })
  }
})
