import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function harness() {
  let reloads = 0
  const window = { sessionStorage: { getItem() { return null }, setItem() {} }, location: { reload() { reloads++ } } }
  const React = { useState: value => [value], useEffect() {}, createElement: (tag, props, ...children) => ({ tag, props, children }) }
  const slice = source.slice(source.indexOf('function isIgnoredTavernError'), source.indexOf('const tavernSessionModes'))
  const api = vm.runInNewContext('(function(){' + slice + ';return {hub:tavernErrorHub,render:TavernErrorCenter};})()', { window, React, URL })
  return { ...api, reloads: () => reloads }
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : [] }

test('模块网络错误不被普通 fetch 过滤吞掉，详情折叠且仅用户点击才刷新', () => {
  const h = harness()
  h.hub.report('poll', new Error('Failed to fetch'))
  assert.equal(h.hub.getSnapshot().length, 0)
  const error = new Error('Failed to fetch dynamically imported module')
  error.dshTavernModuleFailure = { phase: 'module-load', reason: 'unknown', references: ['https://user:private@cdn.example/a.js?token=private'], resources: [] }
  h.hub.report('人物卡脚本「变量结构」', error)
  const tree = h.render(), all = nodes(tree)
  assert.equal(h.hub.getSnapshot().length, 1)
  assert.ok(all.find(n => n.tag === 'details' && !n.props.open))
  assert.doesNotMatch(JSON.stringify(tree), /private/)
  assert.equal(h.reloads(), 0)
  all.find(n => n.tag === 'button' && n.children.includes('刷新页面重试')).props.onClick()
  assert.equal(h.reloads(), 1)
})

test('详情拒绝非数组和超量资源，普通脚本执行错误不出现网络重试提示', () => {
  const h = harness(), error = new Error('依赖失败')
  error.dshTavernModuleFailure = { phase: 'module-load', reason: 'invented', references: 'bad', resources: Array.from({ length: 100 }, () => ({ url: 'https://cdn.example/a.js', status: 404 })) }
  h.hub.report('script', error)
  assert.doesNotThrow(() => h.render())
  const detail = h.hub.getSnapshot()[0].moduleFailure
  assert.equal(detail.reason, 'unknown')
  assert.equal(detail.references.length, 0)
  assert.equal(detail.resources.length, 8)
  h.hub.report('script', new Error('z is not defined'))
  assert.equal(nodes(h.render()).some(n => n.tag === 'details'), false)
})
