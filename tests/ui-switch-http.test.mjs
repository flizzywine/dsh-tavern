import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../tavern-plugin/packages/dsh-tavern-ui-switch/lib/index.js'

const BASE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const SWITCH = 'dsh-tavern-ui-switch'
const HEADERS = { 'X-DSH-Tavern-UI-Switch': '1', 'Content-Type': 'application/json' }

function tavernManifest() {
  return {
    name: 'dsh-profile-tavern',
    private: true,
    dependencies: { 'dsh-tavern-plugin': 'link:./tavern-plugin' },
    dsh: { profile: { bundles: [...BASE, 'dsh-tavern-plugin', SWITCH] } },
    dshTavern: {
      host: 'desktop',
      managedBundles: [...BASE, 'dsh-tavern-plugin', SWITCH],
      managedDependencies: ['dsh-tavern-plugin'],
      officialBundles: [...BASE, SWITCH],
    },
  }
}

function harness() {
  let handler = null
  const server = http.createServer((req, res) => {
    if (handler) handler(req, res)
    else {
      res.writeHead(503)
      res.end()
    }
  })
  const webServer = {
    server,
    register(entry) {
      handler = entry.handler
      return () => {
        handler = null
      }
    },
  }
  return { ctx: { get: (name) => (name === 'webServer' ? webServer : undefined), effect: (fn) => fn() }, server }
}

async function start(manifest = tavernManifest()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ui-switch-http-'))
  const profileDir = path.join(root, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = path.join(profileDir, 'package.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.env.DSH_HOME = root

  const { ctx, server } = harness()
  apply(ctx)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    manifestPath,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

const read = (file) => JSON.parse(readFileSync(file, 'utf8'))

test('the surface reports the current interface', async () => {
  const { base, close } = await start()
  try {
    const data = await (await fetch(`${base}/api/dsh-tavern-ui-switch/state`)).json()
    assert.equal(data.mode, 'tavern')
    assert.equal(data.tavernInstalled, true)
    assert.equal(data.profile, 'desktop')
  } finally {
    await close()
  }
})

test('a switch rewrites the profile and the state follows', async () => {
  const { base, manifestPath, close } = await start()
  try {
    const response = await fetch(`${base}/api/dsh-tavern-ui-switch/switch`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ mode: 'official' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(read(manifestPath).dsh.profile.bundles, [...BASE, SWITCH])
    assert.equal((await (await fetch(`${base}/api/dsh-tavern-ui-switch/state`)).json()).mode, 'official')
  } finally {
    await close()
  }
})

test('a write without the request marker is rejected and changes nothing', async () => {
  const { base, manifestPath, close } = await start()
  try {
    const response = await fetch(`${base}/api/dsh-tavern-ui-switch/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'official' }),
    })
    assert.equal(response.status, 403)
    assert.equal(read(manifestPath).dsh.profile.bundles.length, 4)
  } finally {
    await close()
  }
})

test('an unknown mode and a missing Tavern are rejected', async () => {
  const { base, close } = await start()
  try {
    const bad = await fetch(`${base}/api/dsh-tavern-ui-switch/switch`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ mode: 'chaos' }),
    })
    assert.equal(bad.status, 400)
  } finally {
    await close()
  }

  const plain = await start({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...BASE] } },
  })
  try {
    const noTavern = await fetch(`${plain.base}/api/dsh-tavern-ui-switch/switch`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ mode: 'tavern' }),
    })
    assert.equal(noTavern.status, 409)
  } finally {
    await plain.close()
  }
})

test('the plugin degrades quietly without a web server', () => {
  assert.doesNotThrow(() => apply({ get: () => undefined, effect: (fn) => fn() }))
})
