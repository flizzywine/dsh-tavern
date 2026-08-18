import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import test from 'node:test'

import { encodeWindowsPowerShellScript, isPortOpen, renderWindowsLauncher } from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('Windows launcher quotes paths containing spaces and forwards arguments', () => {
  const launcher = renderWindowsLauncher('D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs')
  assert.equal(
    launcher,
    '@echo off\r\nnode "D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs" %*\r\n',
  )
})

test('Windows update script carries a UTF-8 BOM for Windows PowerShell 5.1', () => {
  assert.equal(encodeWindowsPowerShellScript("Write-Host '模型设置'"), "\uFEFFWrite-Host '模型设置'")
  assert.equal(encodeWindowsPowerShellScript("\uFEFFWrite-Host '模型设置'"), "\uFEFFWrite-Host '模型设置'")
})

test('Windows installer compares Node versions without native argument quoting', () => {
  assert.match(windowsInstaller, /\[version\]\$NodeVersionText\.TrimStart\('v'\)/)
  assert.doesNotMatch(windowsInstaller, /node -e/)
})

test('Tavern no longer bundles dsh-codex-connect and removes it from existing profiles', () => {
  assert.equal(rootManifest.dependencies['dsh-codex-connect'], undefined)
  assert.doesNotMatch(JSON.stringify(rootManifest.dsh.profile.bundles), /dsh-codex-connect/)
  assert.match(launcherSource, /delete dependencies\['dsh-codex-connect'\]/)
})

test('installers reuse existing pnpm and DSH and only install missing packages', () => {
  assert.match(windowsInstaller, /if \(-not \(Test-Command 'pnpm'\)\)/)
  assert.match(windowsInstaller, /if \(-not \(Test-Command 'dsh'\)\)/)
  assert.match(unixInstaller, /if ! command -v pnpm/)
  assert.match(unixInstaller, /if ! command -v dsh/)
})

test('port probe distinguishes an open listener from a closed port', async () => {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.equal(await isPortOpen(address.port), true)
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  assert.equal(await isPortOpen(address.port), false)
})
