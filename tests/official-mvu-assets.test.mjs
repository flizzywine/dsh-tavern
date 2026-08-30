import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle } from '../tavern-plugin/lib/domain/official-mvu-assets.js'

test('官方 MVU 固定产物可离线读取且内容哈希匹配', async function () {
  const asset = await readOfficialMvuBundle()
  assert.equal(OFFICIAL_MVU_VERSION.commit, '0a730cd4a9b99689d1135a49b542c780b977c24c')
  assert.equal(OFFICIAL_MVU_VERSION.assetUrl, '/api/dsh-tavern/vendor/magvarupdate/bundle.js')
  assert.equal(asset.sha256, OFFICIAL_MVU_VERSION.bundleSha256)
  assert.equal(asset.body.length, 307535)
  assert.match(asset.body.toString('utf8', 0, 300), /For license information/)
  assert.match(asset.body.toString('utf8', 0, 300), /import\{klona as/)
})

test('官方 MVU 本地副本保留许可、源码和可复现构建输入', async function () {
  const root = new URL('../tavern-plugin/lib/vendor/magvarupdate/upstream/', import.meta.url)
  await Promise.all([
    access(new URL('LICENSE', root)),
    access(new URL('src/main.ts', root)),
    access(new URL('webpack.config.ts', root)),
    access(new URL('package.json', root)),
    access(new URL('yarn.lock', root))
  ])
  const license = await readFile(new URL('LICENSE', root), 'utf8')
  assert.match(license, /Permission is hereby granted, free of charge/)
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/)
})
