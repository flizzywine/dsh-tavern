import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const encoded = encodeURIComponent('0.2.1版本')
test('test installers and update checks use the same branch for every download transport', () => {
  for (const file of ['install.sh', 'install.ps1', 'tavern-plugin/lib/application-updater.js', 'bin/launcher-environment.mjs']) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.ok(source.includes('/commits/' + encoded), file)
    assert.doesNotMatch(source, /\/commits\/main|@main\/dsh-tavern-runtime\.json|refs\/heads\/main|dsh-tavern\/main\/package\.json/, file)
    if (file.startsWith('install.')) {
      assert.ok(source.includes('refs/heads/' + encoded), file)
      assert.ok(source.includes('@' + encoded + '/dsh-tavern-runtime.json'), file)
      assert.match(source, /--branch[\s\S]{0,5}["']0\.2\.1版本["']/)
      assert.match(source, /origin["']?[, ]+["']0\.2\.1版本["']/)
    }
  }
})
test('public test installer rejects unsupported hosts before touching an installation', { skip: process.platform === 'win32' }, () => {
  for (const host of ['cli', 'android']) {
    const result = spawnSync('sh', [new URL('install.sh', root).pathname], { encoding: 'utf8', env: { ...process.env, DSH_TAVERN_HOST: host } })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /测试版仅支持官方 DeepSeek Harness Desktop/)
  }
})
