import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

test('正式消息 renderer 使用原生 Markdown、完整标签参数，并只为 HTML 创建 iframe', async () => {
  let descriptor, currentView
  const React = { Fragment: 'fragment', createElement: (tag, props, ...children) => ({ tag, props, children }),
    useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? { phase: 'ready', view: currentView } : value, () => {}], useEffect() {}, useMemo: run => run(),
    useSyncExternalStore(_subscribe, get) { const value = get(); return value && typeof value === 'object' && 'phase' in value ? { phase: 'ready', view: currentView } : value } }
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { descriptor = value } } }, console
  })
  const client = descriptor.factory(name => name === 'react' ? React : {
    MarkdownText: 'MarkdownText', Tooltip: 'Tooltip', IconBranchOutline16: 'IconBranchOutline16'
  })
  let Assistant, ForkAction, forkInject
  client.createTavernAssistantRendererFeatureModule().register({ ctx: { effect: (run, label) => label === 'dsh-tavern: game script owner' ? () => {} : run() },
    slots: { inject: (_name, run) => run(), register(spec, component) {
      if (spec.key === 'assistant-step') Assistant = component
      if (spec.id === 'dsh-tavern-fork') { ForkAction = component; forkInject = spec.inject }
      return () => {}
    } } })
  const text = '正文前\n\n```html\n<button>查看状态</button>\n```\n\n正文后'
  const projected = projectReplyLayers(text)
  currentView = { mode: 'story', latestAssistantMessageId: 'assistant-1', debugTurns: [{ turn: 1 }], replyProjections: [{ version: 2, turn: 1, mode: projected.displayMode, parts: projected.displayParts }] }
  const props = { sessionId: 'fixture', node: { data: { status: 'completed', blocks: [{ kind: 'text', text }], finalNode: { seq: 1 } }, location: { kind: 'turn', turn: { turn: 1, status: 'closed' } } }, useTurnData: () => null, fileMentions: () => undefined }
  function leaves(value, result = []) {
    if (Array.isArray(value)) value.forEach(item => leaves(item, result))
    else if (value && typeof value === 'object') { if (value.tag === 'MarkdownText' || value.tag === client.TavernMessageFrame) result.push(value); else leaves(value.children, result) }
    return result
  }
  const registered = Assistant(props)
  const rendered = registered && typeof registered.tag === 'function'
    ? registered.tag(registered.props)
    : registered
  const nodes = leaves(rendered)
  assert.deepEqual(nodes.map(node => node.tag === 'MarkdownText' ? 'markdown' : 'html'), ['markdown', 'html', 'markdown'])
  assert.equal(nodes[0].props.text, '正文前\n\n')
  assert.equal(nodes[2].props.text, '\n正文后')
  for (const node of [nodes[0], nodes[2]]) {
    assert.equal(node.props.labels.code.copyLabel, '复制')
    assert.equal(node.props.labels.code.copiedLabel, '已复制')
    assert.equal(node.props.labels.footnotes, '脚注')
  }
  function buttons(value, result = []) {
    if (Array.isArray(value)) value.forEach(item => buttons(item, result))
    else if (value && typeof value === 'object') {
      if (value.tag === 'button') result.push(value)
      buttons(value.children, result)
    }
    return result
  }
  assert.equal(buttons(rendered).filter(node => node.props['aria-label'] === '从当前进度分叉').length, 0)
  const forkAction = ForkAction({ ...forkInject('fixture'), messageId: 'assistant-1' })
  assert.equal(buttons(forkAction).filter(node => node.props['aria-label'] === '从当前进度分叉').length, 1)
  assert.equal(ForkAction({ ...forkInject('fixture'), messageId: 'older-assistant' }), null)
  props.node.data.status = 'running'
  const streamingRegistration = Assistant(props)
  const streaming = leaves(streamingRegistration && typeof streamingRegistration.tag === 'function'
    ? streamingRegistration.tag(streamingRegistration.props)
    : streamingRegistration)
  assert.equal(streaming.length, 1)
  assert.equal(streaming[0].tag, 'MarkdownText')
  assert.equal(streaming[0].props.streaming, true)
  assert.equal(streaming[0].props.labels.code.copyLabel, '复制')
})
