import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import test from 'node:test'

import { isServiceReady } from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

const installationSource = await readFile(new URL('../bin/profile-installation.mjs', import.meta.url), 'utf8')

const profilePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const managedProfilePatch = await readFile(new URL('../tavern-plugin/cordis.patch.yml', import.meta.url), 'utf8')

const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const tavernPluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))

test('Web 服务就绪检查接受 alpha.2 鉴权响应', async () => {
  assert.equal(await isServiceReady(3081, async () => ({ ok: true })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 401 })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false })), false)
  assert.equal(await isServiceReady(3088, async () => ({ ok: false, status: 403 }), 'android'), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 403 }), 'cli'), false)
  assert.equal(await isServiceReady(3088, async () => ({ ok: false, status: 500 }), 'android'), false)
  assert.equal(await isServiceReady(3081, async () => { throw new Error('offline') }), false)
})
