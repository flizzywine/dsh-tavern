import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findDshCommand } from '../bin/launcher-environment.mjs'

const bridge = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern', import.meta.url))
let dsh = null
try { dsh = findDshCommand() } catch {}

// The host skips a bundle whose @deepseek-ai/dsh* peer misses the running DSH version, so an
// exact-version pin drops the bundle on every newer DSH the installer still accepts.
test('酒馆自带插件包的 DSH peer 覆盖整个支持的 DSH 版本范围', async () => {
  const semver = createRequire(import.meta.url)('semver')
  const root = new URL('../', import.meta.url)
  const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'))
  const { minDshVersion, belowDshVersion } = await json('config/dsh-compatibility.json')
  const supported = `>=${minDshVersion} <${belowDshVersion}`
  const manifest = await json('package.json')
  const local = manifest.dsh.profile.bundles
    .map(name => manifest.devDependencies?.[name])
    .filter(spec => spec?.startsWith('link:'))
  assert.ok(local.length > 0)
  const uncovered = []
  for (const spec of local) {
    const bundle = await json(`${spec.slice('link:./'.length)}/package.json`)
    for (const [name, range] of Object.entries(bundle.peerDependencies || {})) {
      if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
      if (!semver.subset(supported, range, { includePrerelease: true })) uncovered.push(`${bundle.name} ${name}@${range}`)
    }
  }
  assert.deepEqual(uncovered, [], `must cover ${supported}`)
})
