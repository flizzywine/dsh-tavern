import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installationBackupRoot, writeInstallationFile } from '../bin/launcher-environment.mjs'
import { readInstallationReceipt, recordInstallationReceipt } from '../bin/installation-receipt.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-installation-local-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceRoot = path.join(root, 'app'), dshHome = path.join(root, 'home')
  for (const file of [path.join(sourceRoot, 'package.json'), path.join(sourceRoot, 'pnpm-lock.yaml'),
    ...['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'].map(name => path.join(dshHome, 'profiles', 'tavern', name))]) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{}')
  }
  return { root, sourceRoot, dshHome, file: path.join(sourceRoot, '.dsh-tavern-local.json') }
}

test('reinstalling keeps the machine keys of .dsh-tavern-local.json and refreshes only host and dshHome', t => {
  const { root, file } = fixture(t)
  writeInstallationFile({ host: 'cli', dshHome: path.join(root, 'first') }, file)
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), backupRoot: path.join(root, 'backups'), tools: { port: 1 } }))
  writeInstallationFile({ host: 'desktop', dshHome: path.join(root, 'second') }, file)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { host: 'desktop', dshHome: path.join(root, 'second'), backupRoot: path.join(root, 'backups'), tools: { port: 1 } })
})

test('migration backups follow backupRoot, otherwise <DSH home>/backups', () => {
  const home = path.resolve('/dsh-home'), elsewhere = path.resolve('/other-disk/dsh-backups')
  assert.equal(installationBackupRoot({}, home), path.join(home, 'backups'))
  assert.equal(installationBackupRoot({ backupRoot: elsewhere }, home), elsewhere)
})

test('an installation receipt survives machine keys and is invalidated by installer-owned ones', async t => {
  const { root, sourceRoot, dshHome, file } = fixture(t)
  writeInstallationFile({ host: 'cli', dshHome }, file)
  await recordInstallationReceipt({ sourceRoot, dshHome, host: 'cli', attemptId: 'a' })
  writeFileSync(file, JSON.stringify({ backupRoot: path.join(root, 'backups'), host: 'cli', dshHome }))
  assert.equal((await readInstallationReceipt({ sourceRoot, dshHome, host: 'cli' }))?.attemptId, 'a')
  writeInstallationFile({ host: 'cli', dshHome: path.join(root, 'moved') }, file)
  assert.equal(await readInstallationReceipt({ sourceRoot, dshHome, host: 'cli' }), null)
})
