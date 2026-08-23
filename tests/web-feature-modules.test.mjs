import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function clientExports() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const browser = await clientExports()

test('资料库 Feature module 只向宿主暴露注册 interface', function () {
  const feature = browser.createResourcesLibraryFeatureModule()
  let registration
  const effects = []
  const ctx = {
    effect(activate, label) { effects.push(label); return activate() },
    betterSidebar: {
      registerTab(value) { registration = value; return function () {} },
      openFile() {}
    }
  }

  feature.register({ ctx, appendMention() {} })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registration.id, 'dsh-tavern:resources')
  assert.equal(registration.title, '资料库')
  assert.equal(typeof registration.component, 'function')
  assert.deepEqual(effects, ['dsh-tavern: Better Sidebar resources tab'])
})
