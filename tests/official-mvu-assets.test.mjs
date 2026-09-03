import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle, createOfficialMvuBundleReader } from '../tavern-plugin/lib/domain/official-mvu-assets.js'

test('文件读取错误保留原异常，诊断脱敏且观察不会重新读文件', async () => {
  const original = Object.assign(new Error("ENOENT: open 'C:\\Users\\PRIVATE_USER\\bundle.js' apiKey=SECRET_VALUE"), { code: 'ENOENT' })
  let reads = 0
  const reader = createOfficialMvuBundleReader({ read: async () => { reads++; throw original } })
  assert.equal(reader.inspect().phase, 'not-read')
  assert.equal(reads, 0)
  await assert.rejects(reader.read(), error => error === original)
  await assert.rejects(reader.read(), error => error === original)
  const diagnostic = reader.inspect()
  assert.equal(diagnostic.phase, 'read-failed')
  assert.equal(diagnostic.errorCode, 'ENOENT')
  assert.equal(diagnostic.cacheHits, 1)
  assert.equal(reads, 1, '本次仅记录，不改变既有失败缓存行为')
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_USER|SECRET_VALUE/)
  diagnostic.phase = 'forged'
  assert.equal(reader.inspect().phase, 'read-failed')
})

test('校验失败记录实际哈希、字节数和换行格式，而不保存文件内容', async () => {
  const reader = createOfficialMvuBundleReader({ read: async () => Buffer.from('PRIVATE_SCRIPT\r\nline\r\n') })
  await assert.rejects(reader.read(), /本地官方 MVU 产物校验失败/)
  const diagnostic = reader.inspect()
  assert.equal(diagnostic.phase, 'verify-failed')
  assert.equal(diagnostic.errorCode, 'HASH_MISMATCH')
  assert.equal(diagnostic.expectedSha256, OFFICIAL_MVU_VERSION.bundleSha256)
  assert.match(diagnostic.actualSha256, /^[a-f0-9]{64}$/)
  assert.equal(diagnostic.crlfCount, 2)
  assert.equal(diagnostic.loneLfCount, 0)
  assert.equal(diagnostic.bytes, 22)
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_SCRIPT/)
})

test('官方 MVU 固定产物可离线读取且内容哈希匹配', async function () {
  const asset = await readOfficialMvuBundle()
  assert.equal(OFFICIAL_MVU_VERSION.commit, '0a730cd4a9b99689d1135a49b542c780b977c24c')
  assert.equal(OFFICIAL_MVU_VERSION.assetUrl, '/api/dsh-tavern/vendor/magvarupdate/bundle.js')
  assert.equal(asset.sha256, OFFICIAL_MVU_VERSION.bundleSha256)
  assert.equal(asset.body.length, 1250774)
  assert.match(asset.body.toString('utf8', 0, 300), /For license information/)
  assert.doesNotMatch(asset.body.toString('utf8'), /(?:^|;)import[^;]*?from['"]https?:\/\//)
  assert.doesNotMatch(asset.body.toString('utf8'), /testingcf\.jsdelivr\.net\/npm/)
  assert.doesNotMatch(asset.body.toString('utf8'), /window\.parent/)
})

test('官方 MVU 本地副本保留许可、源码和可复现构建输入', async function () {
  const root = new URL('../tavern-plugin/lib/vendor/magvarupdate/upstream/', import.meta.url)
  await Promise.all([
    access(new URL('LICENSE', root)),
    access(new URL('src/main.ts', root)),
    access(new URL('webpack.config.ts', root)),
    access(new URL('package.json', root)),
    access(new URL('yarn.lock', root)),
    access(new URL('.yarnrc.yml', root)),
    access(new URL('../host-build/prepare-host-build.mjs', root)),
    access(new URL('../host-build/build-host-bundle.sh', root))
  ])
  const license = await readFile(new URL('LICENSE', root), 'utf8')
  assert.match(license, /Permission is hereby granted, free of charge/)
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/)
})
