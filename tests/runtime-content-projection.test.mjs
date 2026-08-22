import assert from 'node:assert/strict'
import test from 'node:test'

import { projectRuntimeContent } from '../tavern-plugin/lib/domain/runtime-content-projection.js'

test('游玩投影统一解析宏、分离 HTML，且不修改传入的权威变量', () => {
  const state = { userName: '陈锋', local: { stage: 2 }, global: {} }
  const result = projectRuntimeContent(
    '当前阶段 {{getvar::stage || 1}}。\n<style>.panel{color:red}</style><div class="panel">阶段 {{.stage}}</div>',
    { policy: 'play', charName: '命运', macroState: state }
  )

  assert.equal(result.agentText, '当前阶段 2。')
  assert.match(result.presentationHtml, /阶段 2/)
  assert.deepEqual(result.macroState.local, { stage: 2 })
  assert.deepEqual(state, { userName: '陈锋', local: { stage: 2 }, global: {} })
})

test('卡片编辑与资料阅读使用源码投影，不执行宏也不拆 HTML', () => {
  const source = '{{incvar::stage}}<div>模板</div>'
  const result = projectRuntimeContent(source, {
    policy: 'source',
    charName: '命运',
    macroState: { userName: 'User', local: { stage: 1 }, global: {} }
  })

  assert.equal(result.agentText, source)
  assert.equal(result.presentationHtml, '')
  assert.deepEqual(result.macroState.local, { stage: 1 })
})

test('同一份游玩输入重复投影不会重复修改权威变量', () => {
  const state = { userName: 'User', local: { stage: 1 }, global: {} }
  const first = projectRuntimeContent('{{incvar::stage}}阶段 {{.stage}}', { policy: 'play', macroState: state })
  const second = projectRuntimeContent('{{incvar::stage}}阶段 {{.stage}}', { policy: 'play', macroState: state })

  assert.equal(first.agentText, '2阶段 2')
  assert.equal(second.agentText, '2阶段 2')
  assert.deepEqual(state.local, { stage: 1 })
})

test('开场白预览保留完整渲染结果，不提前剥离 HTML 或提交变量', () => {
  const state = { userName: 'User', local: { stage: 1 }, global: {} }
  const result = projectRuntimeContent(
    '{{incvar::stage}}序章<style>.panel{color:red}</style><div class="panel">阶段 {{.stage}}</div>',
    { policy: 'opening-preview', charName: '命运', macroState: state }
  )

  assert.match(result.agentText, /^2序章<style>/)
  assert.equal(result.bodyText, '2序章')
  assert.match(result.presentationHtml, /阶段 2/)
  assert.equal(result.presentationOnly, false)
  assert.deepEqual(state.local, { stage: 1 })
})

test('确认开场白后才分离正文与 HTML，并识别纯展示页', () => {
  const mixed = projectRuntimeContent('序章<div class="panel">状态</div>', { policy: 'opening-commit' })
  const page = projectRuntimeContent('<div class="cover">封面</div>', { policy: 'opening-commit' })

  assert.equal(mixed.agentText, '序章')
  assert.equal(mixed.presentationOnly, false)
  assert.equal(page.agentText, '')
  assert.equal(page.presentationOnly, true)
})
