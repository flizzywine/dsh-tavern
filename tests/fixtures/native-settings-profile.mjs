import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { syntheticFixture } from '../helpers/synthetic-link-fixture.mjs'

const host = createRequire(process.env.DSH_BOOT_MODULE || new URL('../../package.json', import.meta.url))
const anchor = pathToFileURL(host.resolve('@deepseek-ai/dsh-app-boot')).href
const { boot, readProfilePatches, reconcileProfilePatches } = await import(anchor)
export async function nativeSettingsProfile(t, { ownerSource, ownerUrl, ownerId = 'settings-owner', ownerConfig = {}, settings = true, beforeDispose, setup, extraRows = [], legacy, initialOverrides = [], prepare } = {}) {
  const cleanup = [], home = syntheticFixture({ after: fn => cleanup.push(fn) }, 'native-settings-profile-')
  const dir = path.join(home, 'profile'), bundle = path.join(home, 'node_modules/fixture-bundle'), patchPath = path.join(dir, 'cordis.patch.yml'), configPath = path.join(home, 'cordis.yml')
  let ctx
  t.after(async () => { await beforeDispose?.(); await ctx?.fiber.dispose(); for (const dispose of cleanup) await dispose() })
  await fs.mkdir(dir); await fs.mkdir(bundle, { recursive: true })
  await prepare?.(home)
  if (ownerSource) { const file = path.join(home, 'owner.mjs'); await fs.writeFile(file, ownerSource); ownerUrl = pathToFileURL(file).href }
  if (!ownerUrl) throw new Error('Native settings fixture requires a real owner module')
  const rows = [{ id: 'config-editor', name: '@deepseek-ai/dsh-config-editor' }, { id: 'settings', name: '@deepseek-ai/dsh-settings', disabled: !settings }, { id: ownerId, name: ownerUrl, config: typeof ownerConfig === 'function' ? ownerConfig(home) : ownerConfig }, ...extraRows]
  const base = [{ insert: rows }]
  await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({ name: 'fixture-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await fs.writeFile(path.join(bundle, 'cordis.patch.yml'), JSON.stringify(base))
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-profile', version: '1.0.0', dsh: { profile: { bundles: ['fixture-bundle'] } } }))
  await fs.writeFile(configPath, '[]'); await fs.writeFile(patchPath, JSON.stringify(initialOverrides))
  if (legacy) await fs.writeFile(path.join(home, 'settings.yaml.imported'), JSON.stringify(typeof legacy === 'function' ? legacy(home) : legacy))
  const profile = { home, dir, patchPath, installAnchor: path.join(dir, 'package.json'), overlays: [] }
  const errors = []
  ctx = await boot('dsh', configPath, [...base, ...initialOverrides], root => {
    root.provide('profileContext', profile)
    setup?.(root)
    root.logger.exporter({ levels: { default: 3 }, export: event => { if (event.type === 'error') errors.push(event.args) } })
  }, anchor)
  const overrides = async () => parse(await fs.readFile(patchPath, 'utf8'))
  return { ctx, home, ownerId, errors, overrides,
    value(id, section = id) { return ctx.get('settings').describe().find(row => row.ns === id)?.value[section] },
    update(id, value, section = id) { return ctx.get('settings').mutate(id, Object.entries(value).map(([key, value]) => ({ op: 'set', path: [section, key], value }))) },
    disposeOwner(id = ownerId) { return this.setEnabled(id, false) },
    async setEnabled(id, enabled) {
      const patches = await overrides()
      let row = patches.findLast(item => item.id === id && !item.insert)
      if (!row) patches.push(row = { id })
      row.disabled = !enabled
      await fs.writeFile(patchPath, JSON.stringify(patches))
      await reconcileProfilePatches(ctx, readProfilePatches('dsh', profile), 'dsh')
      await ctx.loader.await()
    },
  }
}
