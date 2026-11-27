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

test('默认参数引用全局对象时，外链模块仍通过当前对话的宿主页接口', () => {
  const context = vm.createContext({
    window: { parent: { document: 'raw' } },
    __dshTavernComposerWindow: { parent: { document: 'scoped' } }
  })
  const source = 'function read(value = globalThis.Mvu) { return window.parent.document } read()'
  assert.equal(vm.runInContext(projectTavernHostScript(source), context), 'scoped')
})

test('远程模块保持原始 URL，并解析同目录的导入', () => {
  const source = 'import "./next.js"; export const url = import.meta.url;'
  const moduleUrl = 'https://example.com/cards/module.js'
  assert.equal(projectTavernHostScript(source, { imports: true, moduleUrl }),
    'import "/api/dsh-tavern/static-assets?url=https%3A%2F%2Fexample.com%2Fcards%2Fnext.js&host=3"; export const url = "https://example.com/cards/module.js";')
  const dynamic = projectTavernHostScript('import(nextUrl)', { imports: true })
  assert.equal(projectTavernHostScript(dynamic, { imports: true }), dynamic)
})
