import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import test from 'node:test'

import { encodeWindowsPowerShellScript, isPortOpen, renderWindowsLauncher } from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')

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

test('port probe distinguishes an open listener from a closed port', async () => {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.equal(await isPortOpen(address.port), true)
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  assert.equal(await isPortOpen(address.port), false)
})
