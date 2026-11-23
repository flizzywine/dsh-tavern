// 自动素材's global layer is a native settings section of dsh-tavern's profile entry. Synthetic profile only.
import test from 'node:test'
import assert from 'node:assert/strict'

// The real profile only lets an entry write fields its Config declares volatile; the global layer lives in dsh-tavern's entry.
test('the global layer saves into the real native settings profile and reads back', async t => {
  const {nativeSettingsProfile} = await import('./fixtures/native-settings-profile.mjs')
  const url = file => JSON.stringify(new URL(file, import.meta.url).href)
  const ownerSource = `export {Config} from ${url('../tavern-plugin/lib/settings-config.js')};
  import {createAutoCastSettings} from ${url('../tavern-plugin/packages/dsh-tavern-stage/lib/asset-engine.js')};
  import {AUTO_CAST_DEFAULTS, AUTO_CAST_SECTION, validateAutoCastLayer} from ${url('../tavern-plugin/lib/domain/card-stage-settings.js')};
  export function apply(ctx){ctx.provide('testAutoCast',createAutoCastSettings(ctx,ctx,{section:AUTO_CAST_SECTION,defaults:AUTO_CAST_DEFAULTS,validateLayer:validateAutoCastLayer}));}`
  const {ctx} = await nativeSettingsProfile(t, {ownerSource, ownerId:'test-auto-cast'})
  const settings = ctx.get('testAutoCast'), before = settings.read()
  assert.deepEqual(before.values, {enabled:false, level:'balanced'})
  assert.equal(before.writable, true)
  await settings.save({expectedRevision:before.revision, patch:{enabled:true, level:'saving'}})
  assert.deepEqual(settings.read().values, {enabled:true, level:'saving'})
  await assert.rejects(settings.save({expectedRevision:settings.read().revision, patch:{level:'sometimes'}}))
})
