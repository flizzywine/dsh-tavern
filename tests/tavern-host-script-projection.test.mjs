import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { projectTavernHostScript } from '../tavern-plugin/lib/domain/tavern-host-script-projection.js'

test('卡片原样访问顶层宿主，编译后进入本地接口，真实顶层窗口仍不可访问', () => {
  const outer = new Proxy({}, { get() { throw Error('cross origin') } })
  const context = vm.createContext({ window: { top: outer }, TavernHelper: { getCharWorldbookNames: () => ({ primary: '本局世界书' }) }, SillyTavern: { getContext: () => ({ ready: true }) } })
  const source = `window.top?.TavernHelper.getCharWorldbookNames('current').primary + ':' + top['SillyTavern'].getContext().ready`
  assert.throws(() => vm.runInContext(source, context), /cross origin/)
  assert.equal(vm.runInContext(projectTavernHostScript(source), context), '本局世界书:true')
  assert.throws(() => vm.runInContext(projectTavernHostScript('window.top.document'), context), /cross origin/)
})
