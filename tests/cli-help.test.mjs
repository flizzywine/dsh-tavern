import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import test from 'node:test'

import { COMMANDS, commandNames, hasCommand, renderCommandHelp, renderHelp, tavernVersion } from '../bin/cli-help.mjs'

const execFileAsync = promisify(execFile)
const launcher = fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url))
const packageFile = new URL('../package.json', import.meta.url)
const version = JSON.parse(await readFile(packageFile, 'utf8')).version
const yamlPackage = fileURLToPath(new URL('../node_modules/yaml/package.json', import.meta.url))
const hasDependencies = existsSync(yamlPackage)

async function runCli(args, env = {}) {
  const options = {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_TAVERN_NO_OPEN: '1', ...env },
    timeout: 20000,
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [launcher, ...args], options)
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    if (typeof error.code !== 'number') throw error
    return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

test('总帮助覆盖全部命令、环境变量与退出码', () => {
  const help = renderHelp({ version: '9.9.9' })
  assert.equal(help.split('\n')[0], 'DSH 酒馆（dsh-tavern）9.9.9')
  for (const command of COMMANDS) {
    assert.ok(help.includes(command.name), '缺少命令：' + command.name)
    assert.ok(help.includes(command.summary), '缺少说明：' + command.name)
  }
  for (const name of ['DSH_TAVERN_HOST=cli|desktop|next|android', 'DSH_TAVERN_PORT=3081', 'DSH_TAVERN_BIND=127.0.0.1', 'DSH_TAVERN_CLI_HOME=~/.dsh-tavern', 'DSH_TAVERN_NO_OPEN=1', 'DSH_TAVERN_START_TIMEOUT=120']) {
    assert.ok(help.includes(name), '缺少环境变量：' + name)
  }
  assert.ok(help.includes('常用示例'))
  assert.ok(help.includes('退出码：0 成功；1 执行失败；2 未知命令或参数。'))
  assert.ok(help.includes('全局选项：'))
  assert.ok(help.includes('-h, --help'))
  assert.ok(help.includes('-v, -V, --version'))
  assert.ok(help.includes('结束选项'))
  assert.ok(help.includes('https://github.com/flizzywine/dsh-tavern/wiki'))
  assert.equal(help.includes(String.fromCharCode(27)), false)
})

test('每个命令都有可用的分命令帮助', () => {
  for (const name of commandNames()) {
    const text = renderCommandHelp(name)
    assert.ok(text.startsWith('用法：'), '缺少用法：' + name)
    assert.ok(text.includes('dsh-tavern ' + name), '用法缺少命令名：' + name)
  }
  assert.equal(hasCommand('install'), true)
  assert.equal(hasCommand('nope'), false)
  assert.equal(renderCommandHelp('nope'), '')
})

test('completion 与 man 帮助说明用法', () => {
  const completion = renderCommandHelp('completion')
  for (const shell of ['bash', 'zsh', 'fish', 'powershell']) assert.ok(completion.includes(shell), '缺少 shell：' + shell)
  const man = renderCommandHelp('man')
  assert.ok(man.includes('roff'))
  assert.ok(man.includes('dsh-tavern man'))
})

test('install 帮助说明四种宿主与前置条件', () => {
  const text = renderCommandHelp('install')
  assert.ok(text.includes('--host cli|desktop|next|android'))
  for (const host of ['cli', 'desktop', 'next', 'android']) assert.ok(text.includes(host), '缺少宿主：' + host)
  assert.ok(text.includes('Node.js 22.19+'))
  assert.ok(text.includes('~/.dsh-tavern'))
  assert.ok(text.includes('dsh-tavern install --host next'))
})

test('update 帮助不暴露安装器内部参数', () => {
  const text = renderCommandHelp('update')
  for (const flag of ['--status-file', '--delay', '--attempt-id', '--target-commit', '--desktop-pids']) {
    assert.equal(text.includes(flag), false, '不应出现内部参数：' + flag)
  }
})

test('版本读取与打包版本一致', () => {
  assert.equal(tavernVersion(), version)
})

test('命令行帮助、分命令帮助与版本输出', { skip: !hasDependencies }, async () => {
  const help = await runCli(['--help'])
  assert.equal(help.exitCode, 0)
  assert.equal(help.stderr, '')
  assert.ok(help.stdout.includes('安装与更新：'))
  assert.ok(help.stdout.includes('start'))
  assert.ok(help.stdout.includes('completion'))
  assert.ok(help.stdout.includes('man'))
  const install = await runCli(['help', 'install'])
  assert.equal(install.exitCode, 0)
  assert.ok(install.stdout.includes('--host cli|desktop|next|android'))
  assert.ok(install.stdout.includes('命令行版'))
  const short = await runCli(['-h'])
  assert.equal(short.exitCode, 0)
  assert.ok(short.stdout.includes('用法：'))
  const versionOutput = await runCli(['--version'])
  assert.equal(versionOutput.exitCode, 0)
  assert.equal(versionOutput.stdout.trim(), 'dsh-tavern ' + version)
  const shortVersion = await runCli(['-v'])
  assert.equal(shortVersion.stdout.trim(), 'dsh-tavern ' + version)
  const upperVersion = await runCli(['-V'])
  assert.equal(upperVersion.stdout.trim(), 'dsh-tavern ' + version)
})

test('未知命令与未知帮助主题以退出码 2 报错', { skip: !hasDependencies }, async () => {
  for (const args of [['frobnicate'], ['help', 'frobnicate']]) {
    const result = await runCli(args)
    assert.equal(result.exitCode, 2, '退出码不符：' + args.join(' '))
    assert.equal(result.stdout, '', 'stdout 应为空：' + args.join(' '))
    assert.ok(result.stderr.includes('未知命令：frobnicate'), '缺少错误提示：' + args.join(' '))
    assert.ok(result.stderr.includes('运行 dsh-tavern help 查看可用命令。'))
  }
})

test('桌面宿主下 --help 不触发应用重启', { skip: !hasDependencies }, async () => {
  const desktopEnv = {
    DSH_TAVERN_RUNTIME_HOST: 'desktop',
    DSH_TAVERN_HOST: 'desktop',
    DSH_DESKTOP_APP_EXECUTABLE: '/nonexistent/dsh-desktop',
  }
  for (const args of [['install', '--help'], ['start', '--help'], ['completion', '--help']]) {
    const started = Date.now()
    const result = await runCli(args, desktopEnv)
    assert.equal(result.exitCode, 0, '应直接返回帮助：' + args.join(' '))
    assert.ok(result.stdout.includes('用法：'), '缺少帮助输出：' + args.join(' '))
    assert.ok(Date.now() - started < 5000, '帮助不应触发桌面重启：' + args.join(' '))
  }
})
