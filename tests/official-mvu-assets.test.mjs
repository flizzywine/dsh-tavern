import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { readOfficialMvuBundle, createOfficialMvuBundleReader } from '../tavern-plugin/lib/domain/official-mvu-assets.js'

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
  assert.equal(diagnostic.cacheHits, 0)
  assert.equal(reads, 2, '失败不永久缓存，后续请求重新读取')
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_USER|SECRET_VALUE/)
  diagnostic.phase = 'forged'
  assert.equal(reader.inspect().phase, 'read-failed')
})

test('文件恢复后重新校验并缓存成功产物，并发请求共用读取', async () => {
  const good = (await readOfficialMvuBundle()).body
  let reads = 0
  const reader = createOfficialMvuBundleReader({ read: async () => { if (++reads === 1) throw Error('temporary read failure'); return good } })
  await assert.rejects(reader.read(), /temporary/)
  const [first, second] = await Promise.all([reader.read(), reader.read()])
  assert.equal(first, second)
  assert.equal(reads, 2)
  assert.equal(reader.inspect().phase, 'verified')
  assert.equal(reader.inspect().error, undefined)
  assert.equal(await reader.read(), first)
  assert.equal(reads, 2)
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
  const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8')
  assert.match(license, /Permission is hereby granted, free of charge/)
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/)
  assert.match(attributes, /tavern-plugin\/lib\/vendor\/magvarupdate\/host-build\/artifact\/bundle\.js -text/)
})
