import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { COMMANDS, HOST_VALUES, commandNames, renderHelp } from '../bin/cli-help.mjs'
import { COMPLETION_SHELLS, renderCompletion } from '../bin/cli-completion.mjs'
import { renderManPage } from '../bin/cli-man.mjs'

const launcher = fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url))
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const yamlPackage = fileURLToPath(new URL('../node_modules/yaml/package.json', import.meta.url))
const hasDependencies = existsSync(yamlPackage)

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_TAVERN_NO_OPEN: '1', ...env },
    encoding: 'utf8',
    timeout: 20000,
  })
  if (result.error) throw result.error
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('补全脚本覆盖四种 shell、全部命令与宿主', () => {
  assert.deepEqual(COMPLETION_SHELLS, ['bash', 'zsh', 'fish', 'powershell'])
  for (const shell of COMPLETION_SHELLS) {
    const script = renderCompletion(shell)
    assert.ok(script.length > 0, '缺少补全脚本：' + shell)
    for (const name of commandNames()) assert.ok(script.includes(name), shell + ' 缺少命令：' + name)
    for (const host of HOST_VALUES) assert.ok(script.includes(host), shell + ' 缺少宿主：' + host)
  }
  assert.equal(renderCompletion('nope'), '')
})

test('补全脚本带有各 shell 的启用标记', () => {
  const bash = renderCompletion('bash')
  assert.ok(bash.startsWith('# bash completion'))
  assert.ok(bash.includes('complete -F _dsh_tavern dsh-tavern'))
  assert.ok(bash.includes('compgen'))
  const zsh = renderCompletion('zsh')
  assert.ok(zsh.startsWith('#compdef dsh-tavern'))
  assert.ok(zsh.includes('_describe'))
  const fish = renderCompletion('fish')
  assert.ok(fish.includes('complete -c dsh-tavern'))
  assert.ok(fish.includes('__fish_use_subcommand'))
  const powershell = renderCompletion('powershell')
  assert.ok(powershell.includes('Register-ArgumentCompleter -Native -CommandName dsh-tavern'))
  assert.ok(powershell.includes('CompletionResult'))
})

test('bash 补全脚本通过 bash -n 语法检查', () => {
  const checked = spawnSync('bash', ['-n'], { input: renderCompletion('bash'), encoding: 'utf8' })
  if (checked.error?.code === 'ENOENT') return
  assert.equal(checked.status, 0, checked.stderr)
})

test('man 手册包含标准段落、全部命令与环境变量', () => {
  const page = renderManPage({ version: '9.9.9' })
  assert.ok(page.startsWith('.TH DSH-TAVERN 1'))
  for (const section of ['.SH NAME', '.SH SYNOPSIS', '.SH DESCRIPTION', '.SH COMMANDS', '.SH OPTIONS', '.SH ENVIRONMENT', '.SH "EXIT STATUS"', '.SH "SEE ALSO"']) {
    assert.ok(page.includes(section), '缺少段落：' + section)
  }
  for (const name of commandNames()) assert.ok(page.includes('\n.B ' + name + '\n'), '缺少命令：' + name)
  assert.ok(page.includes('9.9.9'))
  assert.ok(page.includes('DSH_TAVERN_PORT=3081'))
  assert.ok(page.includes('\\-\\-host'), '连字符应转义')
  assert.ok(page.includes('未知命令或参数'))
})

test('全帮助列出全局选项与补全、man 命令', () => {
  const help = renderHelp({ version: '9.9.9' })
  assert.ok(help.includes('全局选项：'))
  assert.ok(help.includes('-h, --help'))
  assert.ok(help.includes('-v, -V, --version'))
  assert.ok(help.includes('结束选项'))
  for (const command of COMMANDS) assert.ok(help.includes(command.name), '缺少命令：' + command.name)
})

test('安装与更新解析器接受 -- 终止符', { skip: !hasDependencies }, async () => {
  const { parseInstallHost } = await import('../bin/profile-installation.mjs')
  const { parseUpdateOptions } = await import('../bin/application-update.mjs')
  assert.equal(parseInstallHost(['--host', 'cli', '--']), 'cli')
  assert.ok(HOST_VALUES.includes(parseInstallHost(['--'])))
  assert.throws(() => parseInstallHost(['--', '--host', 'cli']), /无法识别的安装参数：--host/)
  assert.equal(parseUpdateOptions(['--host', 'cli', '--']).host, 'cli')
  assert.throws(() => parseUpdateOptions(['--', '--host']), /无法识别的更新参数：--host/)
  const { INSTALL_HOSTS } = await import('../bin/launcher-environment.mjs')
  assert.deepEqual([...INSTALL_HOSTS].sort(), [...HOST_VALUES].sort())
})

test('completion 与 man 命令输出脚本和手册', { skip: !hasDependencies }, () => {
  const completion = runCli(['completion', 'bash'])
  assert.equal(completion.exitCode, 0)
  assert.equal(completion.stderr, '')
  assert.ok(completion.stdout.includes('complete -F _dsh_tavern dsh-tavern'))
  const missing = runCli(['completion'])
  assert.equal(missing.exitCode, 2)
  assert.ok(missing.stderr.includes('缺少 shell 参数'))
  const unsupported = runCli(['completion', 'nope'])
  assert.equal(unsupported.exitCode, 2)
  assert.ok(unsupported.stderr.includes('不支持的 shell：nope'))
  const man = runCli(['man'])
  assert.equal(man.exitCode, 0)
  assert.ok(man.stdout.startsWith('.TH DSH-TAVERN 1'))
  const versionFlag = runCli(['-V'])
  assert.equal(versionFlag.exitCode, 0)
  assert.equal(versionFlag.stdout.trim(), 'dsh-tavern ' + version)
})

test('-- 终止符区分帮助参数与位置参数', { skip: !hasDependencies }, () => {
  const helpAfter = runCli(['help', '--', 'install'])
  assert.equal(helpAfter.exitCode, 0)
  assert.ok(helpAfter.stdout.includes('--host cli|desktop|next|android'))
  const completionAfter = runCli(['completion', '--', 'bash'])
  assert.equal(completionAfter.exitCode, 0)
  assert.ok(completionAfter.stdout.includes('complete -F _dsh_tavern dsh-tavern'))
  const installAfter = runCli(['install', '--', '--host', 'cli'])
  assert.notEqual(installAfter.exitCode, 0)
  assert.ok(installAfter.stderr.includes('无法识别的安装参数：--host'))
  const noHelp = runCli(['install', '--', '--help'])
  assert.notEqual(noHelp.exitCode, 0)
  assert.equal(noHelp.stdout, '')
  assert.ok(noHelp.stderr.includes('无法识别的安装参数：--help'))
})

test('desktop 与 next 宿主下 completion、man 不重启应用', { skip: !hasDependencies }, () => {
  const desktopEnv = {
    DSH_TAVERN_RUNTIME_HOST: 'desktop',
    DSH_TAVERN_HOST: 'desktop',
    DSH_DESKTOP_APP_EXECUTABLE: '/nonexistent/dsh-desktop',
  }
  for (const args of [['completion', 'zsh'], ['man']]) {
    const started = Date.now()
    const result = runCli(args, desktopEnv)
    assert.equal(result.exitCode, 0, '应直接输出：' + args.join(' '))
    assert.ok(Date.now() - started < 5000, '不应触发桌面重启：' + args.join(' '))
  }
  const next = runCli(['completion', 'fish'], { DSH_TAVERN_RUNTIME_HOST: 'next' })
  assert.equal(next.exitCode, 0)
  assert.ok(next.stdout.includes('complete -c dsh-tavern'))
})
