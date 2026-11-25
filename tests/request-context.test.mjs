import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeRequestCacheDiff, extractPrefixSlots } from '../tavern-plugin/lib/domain/request-cache-diff.js'
import { omitUnusedToolHistory } from '../tavern-plugin/lib/domain/tool-history-presentation.js'


// The panel is a client fragment concatenated into the built bundle, so exercise
// the source file the way the other feature tests do.
const client = vm.createContext({ window: {} })
vm.runInContext(readFileSync(new URL('../tavern-plugin/lib/domain/writing-material-receipts.cjs', import.meta.url), 'utf8'), client)
vm.runInContext(readFileSync(new URL('../tavern-plugin/src/client/modules/context-window-model.js', import.meta.url), 'utf8'), client, { filename: 'context-window-model.js' })
vm.runInContext(readFileSync(new URL('../tavern-plugin/src/client/features/request-context.js', import.meta.url), 'utf8'), client, { filename: 'request-context.js' })
// vm 里造出来的数组和对象带的是那边的原型，deepEqual 会判成不相等；先搬回本 realm。
const sections = request => structuredClone(client.requestContextSections(request))
const tokens = text => client.estimateTavernTokens(text)
const titles = request => sections(request).map(section => section.title)

const preset = (phase, text) => ({
  role: phase === 'back' ? 'user' : 'system',
  content: [{ type: 'text', text }],
  source: { kind: 'plugin:dsh-tavern', form: 'snapshot', sections: [{ name: 'tavern:runtime-preset-' + phase, text }] }
})

test('完整上下文按已记录的前台请求区分普通前台和白手套模式', () => {
  const reply = { scope: 'foreground', task: 'reply', turn: 2, request: { messages: [] } }
  assert.equal(client.foregroundRequestMode(reply), 'standard')
  const noInjection = { ...reply, frame: { append: { reason: 'pure-writing', appended: false } } }
  assert.equal(client.foregroundRequestMode(noInjection), 'white-glove')
  const marker = { source: { kind: 'plugin:dsh-tavern-pure-writer', form: 'write' } }
  assert.equal(client.foregroundRequestMode({ ...reply, request: { messages: [marker] } }), 'white-glove')
  const legacyInjection = { source: { ...marker.source, form: 'inject' } }
  assert.equal(client.foregroundRequestMode({ ...reply, request: { messages: [legacyInjection] } }), 'white-glove')
  const earlierInjection = { source: { ...legacyInjection.source, trace: { turn: 1 } } }
  assert.equal(client.foregroundRequestMode({ ...reply, request: { messages: [earlierInjection] } }), 'standard')
  assert.equal(client.foregroundRequestMode({ ...reply, scope: 'background' }), '')
  assert.equal(client.foregroundRequestMode({ ...reply, task: 'compaction' }), '')
})

test('白手套的世界书标题提示归入世界书筛选', () => {
  const [row] = sections({ messages: [{
    role: 'user', source: { kind: 'plugin:dsh-tavern-pure-writer', form: 'worldbook-title-hints' },
    content: [{ type: 'text', text: '<lorebook_title_hints>\n可能用到的世界书条目：钟楼\n</lorebook_title_hints>' }]
  }] })
  assert.deepEqual(row.sources, [{ category: 'worldbook', label: '世界书标题提示' }])
})

test('白手套注入保留实际回执和缓存位置，并按资料类型可筛选', () => {
  const text = '### 钟楼\n钟声整点响。\n\n【写作指引】\n采用第三人称。\n\n【剧情记忆 · 第 1 轮】\n找到钥匙。\n\n【当前状态】\n林婉还剩三张车票。'
  const content = [{ type: 'text', text }]
  const request = { messages: [
    { role: 'user', content, source: { kind: 'user' } },
    { role: 'user', content, source: { kind: 'plugin:dsh-tavern-pure-writer', form: 'inject', trace: { turn: 1 } } }
  ] }
  const [player, injection] = sections(request)
  assert.deepEqual(player.sources, [{ category: 'story', label: '玩家输入' }])
  assert.deepEqual(injection.sources, [
    { category: 'injection', label: '白手套注入' },
    { category: 'worldbook', label: '世界书' },
    { category: 'skill', label: '写作 Skill' },
    { category: 'story', label: '剧情记忆' },
    { category: 'state', label: '当前状态' }
  ])
  assert.deepEqual(injection.body, [text])
  assert.equal(injection.title, 'messages[1] · user · 第 1 轮注入')
  assert.deepEqual(injection.value, request.messages[1])
  assert.equal(injection.cacheKey, extractPrefixSlots(request)[1].key)
})

test('工具定义夹在前置系统消息与普通消息之间，消息下标保持原样', () => {
  const request = {
    tools: [{ type: 'function', function: { name: 'tavern_read_play_chat' } }],
    messages: [preset('front', '前段'), { role: 'system', content: '系统' }, { role: 'user', content: '正文' }, { role: 'assistant', content: '回复' }]
  }
  // 工具是请求字段，不是最后一条消息；挪到末尾会让人以为它跟着对话走。
  assert.deepEqual(titles(request), ['messages[0] · system · 预设前段', 'messages[1] · system', 'tools · 工具定义', 'messages[2] · user', 'messages[3] · assistant'])
})

test('旧请求的调用参数不展开工具历史，实际工具定义照常显示', () => {
  const tools = [{ name: 'submit_story' }]
  const request = { model: 'deepseek-flash', toolHistory: { tools: [{ name: 'bash' }], updates: [] }, tools, messages: [] }
  const rows = sections(request)
  assert.deepEqual(rows.find(row => row.cacheKey === 'field:metadata').value, { model: 'deepseek-flash' })
  assert.deepEqual(rows.find(row => row.cacheKey === 'field:tools').value, tools)
  assert.equal(request.toolHistory.tools[0].name, 'bash')
})

test('工具历史只在工具声明一致且回放更新仍在时保留', () => {
  const tools = [{ name: 'skill' }, { name: 'submit_story' }]
  const messages = [{ role: 'developer', id: 'change', content: [{ type: 'tool-addition', toolName: 'submit_story' }] }]
  const toolHistory = { tools: [tools[0]], updates: [{ messageId: 'change', additions: [tools[1]] }] }
  const valid = { tools, messages, toolHistory }
  assert.equal(omitUnusedToolHistory(valid), valid)
  const stale = { ...valid, toolHistory: { ...toolHistory, tools: [{ name: 'bash' }, tools[0]] } }
  assert.deepEqual(omitUnusedToolHistory(stale), { tools, messages })
  assert.deepEqual(omitUnusedToolHistory({ ...valid, messages: [] }), { tools, messages: [] })
  assert.deepEqual(omitUnusedToolHistory({ ...valid, toolHistory: { tools, updates: [] } }), { tools, messages })
  const compaction = { ...stale, purpose: 'compaction' }
  assert.equal(omitUnusedToolHistory(compaction), compaction)
})

test('预设前段、后段会从消息正文里切出来，仍归属同一条消息', () => {
  const body = '我推开门，风灌进来。'
  const back = '【写作规则】保持克制。'
  const request = {
    messages: [
      // 系统消息：前段 + 系统正文拼成一条，靠来源节切分。
      { role: 'system', content: '【前段】' + '你是叙述者。', source: { sections: [{ name: 'tavern:runtime-preset-front', text: '【前段】' }, { name: 'tavern:dsh-system', text: '你是叙述者。' }] } },
      // 回合输入与末尾预设被合并进同一条 user 消息，这是运行时本来的形状。
      { role: 'user', content: body + '\n\n' + back, source: { sections: [{ name: 'tavern:turn', text: body }, { name: 'tavern:runtime-preset-back', text: back }] } }
    ]
  }
  assert.deepEqual(titles(request), ['messages[0] · system · 预设前段', 'messages[0] · system · 消息正文', 'messages[1] · user · 消息正文', 'messages[1] · user · 预设后段'])
  const byTitle = Object.fromEntries(sections(request).map(section => [section.title, section]))
  assert.equal(byTitle['messages[0] · system · 预设前段'].text, '【前段】')
  assert.equal(byTitle['messages[0] · system · 消息正文'].text, '你是叙述者。')
  assert.equal(byTitle['messages[1] · user · 预设后段'].text, back)
  assert.ok(byTitle['messages[1] · user · 消息正文'].text.startsWith(body))
  // 切分后每节的字符数只算正文，不含分节之间补的分隔符。
  for (const section of Object.values(byTitle)) assert.equal(section.count, section.body.reduce((sum, text) => sum + text.length, 0))
})

test('token 估算：中文约 1.5、拉丁约每 4 字母 1 个、数字约每 3 位 1 个', () => {
  assert.equal(tokens(''), 0)
  assert.equal(tokens(undefined), 0)
  assert.equal(tokens('汉'.repeat(100)), 150)
  assert.equal(tokens('a'.repeat(400)), 100)
  assert.equal(tokens('1'.repeat(30)), 10)
  // 只做量级比较：加字不会让估算变少。
  for (let length = 1; length <= 40; length += 3) assert.ok(tokens('汉'.repeat(length + 3)) >= tokens('汉'.repeat(length)))
})

test('前端 requestContextSections 的 cacheKey 与后端 extractPrefixSlots 完全对齐', () => {
  const request = {
    model: 'claude-sonnet',
    system: '根系统提示',
    tools: [{ type: 'function', function: { name: 't1' } }],
    messages: [
      { role: 'system', content: '【前段】主体', source: { sections: [{ name: 'tavern:runtime-preset-front', text: '【前段】' }, { name: 'tavern:dsh-system', text: '主体' }] } },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀' }
    ]
  }
  const clientKeys = sections(request).map(s => s.cacheKey).filter(key => key !== 'field:metadata')
  const serverKeys = extractPrefixSlots(request).map(s => s.key)
  assert.deepEqual(clientKeys, serverKeys)
})

test('缓存对比：纯追加场景标记 hit 与 appended，并按互斥 usage 桶计算真实命中率', () => {
  const prev = {
    id: 'r1', turn: 1, step: 1, createdAt: 1000,
    request: {
      model: 'claude-sonnet',
      system: '稳定系统提示',
      tools: [{ name: 'tool_a' }],
      messages: [{ role: 'user', content: '第一句' }, { role: 'assistant', content: '第一答' }]
    }
  }
  const cur = {
    id: 'r2', turn: 2, step: 1, createdAt: 2000,
    usage: { inputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100, outputTokens: 50 },
    request: {
      ...prev.request,
      messages: [...prev.request.messages, { role: 'user', content: '第二句' }]
    }
  }
  const diff = computeRequestCacheDiff(cur, prev, { id: 'r1', turn: 1, step: 1, createdAt: 1000 })
  assert.equal(diff.compareStatus, 'compared')
  assert.equal(diff.breakPoint, null)
  assert.equal(diff.usage.totalInputTokens, 1000)
  assert.equal(diff.usage.hitRate, 0.8)
  assert.equal(diff.sectionStatus['field:system'], 'hit')
  assert.equal(diff.sectionStatus['field:tools'], 'hit')
  assert.equal(diff.sectionStatus['msg:0'], 'hit')
  assert.equal(diff.sectionStatus['msg:1'], 'hit')
  assert.equal(diff.sectionStatus['msg:2'], 'appended')
})

test('缓存对比：系统段内世界书变动精确定位到破坏源头与行级 diff，并标出受波及历史段落', () => {
  const makeSys = wb => ({
    role: 'system',
    content: '固定设定\n' + wb,
    source: { sections: [{ name: 'tavern:dsh-system', text: '固定设定\n' }, { name: 'tavern:activeWorldbook:1', text: wb }] }
  })
  const prev = {
    id: 'r1', turn: 1, step: 1, createdAt: 1000,
    request: {
      model: 'claude-sonnet',
      messages: [makeSys('世界书旧条目A'), { role: 'user', content: '历史问' }, { role: 'assistant', content: '历史答' }]
    }
  }
  const cur = {
    id: 'r2', turn: 2, step: 1, createdAt: 2000,
    request: {
      model: 'claude-sonnet',
      messages: [makeSys('世界书新条目B'), { role: 'user', content: '历史问' }, { role: 'assistant', content: '历史答' }, { role: 'user', content: '本轮新问' }]
    }
  }
  const diff = computeRequestCacheDiff(cur, prev, { id: 'r1', turn: 1, step: 1, createdAt: 1000 })
  assert.equal(diff.sectionStatus['msg:0'], 'break')
  assert.equal(diff.sectionStatus['msg:1'], 'cascade')
  assert.equal(diff.sectionStatus['msg:2'], 'cascade')
  assert.equal(diff.sectionStatus['msg:3'], 'appended')
  assert.equal(diff.breakPoint.key, 'msg:0')
  assert.equal(diff.breakPoint.partLabel, '本轮世界书')
  assert.equal(diff.breakPoint.affectedSections, 2)
  assert.equal(diff.breakPoint.diff.removedLines, 1)
  assert.equal(diff.breakPoint.diff.addedLines, 1)
  assert.ok(diff.breakPoint.diff.lines.some(l => l.type === 'del' && l.text.includes('世界书旧条目A')))
  assert.ok(diff.breakPoint.diff.lines.some(l => l.type === 'add' && l.text.includes('世界书新条目B')))
  // 同一段内破坏点之前的「固定设定」仍计入 hitTokens，不归入 breakTokens
  assert.ok(diff.estimated.hitTokens > 0)
  assert.equal(
    diff.estimated.hitTokens + diff.estimated.breakTokens + diff.estimated.cascadeTokens + diff.estimated.appendedTokens,
    diff.estimated.totalTokens
  )
})

test('缓存对比：同一消息段内中部子块变动时，前置子块计入 hit、中段计入 break、后置子块计入 cascade', () => {
  const partA = '前置固定正文内容，用于验证仍然命中缓存前缀。'
  const partB1 = '掷骰结果: 2d6 骰出 [3 + 6] = 9'
  const partB2 = '掷骰结果: 2d6 骰出 [4 + 4] = 8'
  const partC = '后置候选项列表内容，受前面差异波及而失效。'
  const makeMsg = mid => ({
    role: 'user',
    content: partA + '\n\n' + mid + '\n\n' + partC,
    source: {
      sections: [
        { name: 'tavern:turn', text: partA },
        { name: 'tavern:currentStateProjection:1', text: mid },
        { name: 'tavern:currentStateProjection:2', text: partC }
      ]
    }
  })
  const prev = { id: 'r1', turn: 1, step: 1, createdAt: 1000, request: { model: 'claude-sonnet', messages: [makeMsg(partB1)] } }
  const cur = { id: 'r2', turn: 2, step: 1, createdAt: 2000, request: { model: 'claude-sonnet', messages: [makeMsg(partB2)] } }
  const diff = computeRequestCacheDiff(cur, prev, { id: 'r1', turn: 1, step: 1, createdAt: 1000 })
  assert.equal(diff.sectionStatus['msg:0'], 'break')
  assert.equal(diff.breakPoint.partIndex, 1)
  assert.equal(diff.breakPoint.partLabel, '当前状态')
  assert.ok(diff.estimated.hitTokens > 0)
  assert.ok(diff.estimated.breakTokens > 0)
  assert.ok(diff.estimated.cascadeTokens > 0)
  assert.equal(
    diff.estimated.hitTokens + diff.estimated.breakTokens + diff.estimated.cascadeTokens + diff.estimated.appendedTokens,
    diff.estimated.totalTokens
  )
  assert.equal(diff.breakPoint.affectedTokens, diff.estimated.cascadeTokens)
})

test('实际命中率优先展示，本地前缀差异仍可定位，估算 token 不混入实际用量', () => {
  const previous = { id: 'r1', turn: 1, step: 1, request: { model: 'm', system: '原系统提示' } }
  const current = { id: 'r2', status: 'completed', request: { model: 'm', system: '汉'.repeat(26213) } }
  const render = usage => {
    const record = { ...current, usage }
    record.cacheDiff = computeRequestCacheDiff(record, previous, previous)
    return renderToStaticMarkup(client.renderCacheDiffSummary(createElement, record, () => {}))
  }

  const actual = render({ inputTokens: 215, cacheReadTokens: 25344 })
  assert.match(actual, /实际命中 99\.2%/)
  assert.ok(actual.includes('总输入 ' + (25559).toLocaleString()))
  assert.match(actual, /定位前缀差异/)
  assert.match(actual, /本地前缀差异/)
  assert.doesNotMatch(actual, /破坏命中|连带失效|tokens/)

  const estimated = render(undefined)
  assert.match(estimated, /预估一致前缀 0\.0%/)
  assert.ok(estimated.includes('本地估算共约 ' + (39320).toLocaleString() + ' tokens'))
  assert.match(estimated, /定位前缀差异/)
})

test('缓存对比：模型变更、TTL 零命中与基线已清理场景', () => {
  const baseReq = { model: 'm-a', system: 's', messages: [{ role: 'user', content: 'hi' }] }
  const switched = computeRequestCacheDiff(
    { id: 'r2', usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, request: { ...baseReq, model: 'm-b' } },
    { id: 'r1', request: baseReq },
    { id: 'r1', turn: 1, step: 1, createdAt: 1000 }
  )
  assert.equal(switched.modelChanged, true)
  assert.equal(switched.breakPoint.kind, 'model')
  assert.equal(switched.sectionStatus['field:metadata'], 'break')
  assert.equal(switched.sectionStatus['field:system'], 'cascade')
  assert.equal(switched.zeroReadReason, 'model-changed')

  const ttlZero = computeRequestCacheDiff(
    { id: 'r2', usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, request: { ...baseReq, messages: [...baseReq.messages, { role: 'user', content: 'next' }] } },
    { id: 'r1', request: baseReq },
    { id: 'r1', turn: 1, step: 1, createdAt: 1000 }
  )
  assert.equal(ttlZero.breakPoint, null)
  assert.equal(ttlZero.zeroReadReason, 'ttl-or-provider')

  const pruned = computeRequestCacheDiff(
    { id: 'r2', request: baseReq },
    null,
    { id: 'r1', turn: 1, step: 1, createdAt: 1000, pruned: true }
  )
  assert.equal(pruned.compareStatus, 'baseline-pruned')
  assert.equal(pruned.baseline.pruned, true)
})

test('每段消息按世界书、预设、人物卡、正文、状态、插件、工具正确标注来源', () => {
  const request = {
    model: 'claude-sonnet',
    system: '根系统提示',
    tools: [{ name: 't1' }],
    messages: [
      {
        role: 'system',
        content: '常驻条目\n人物设定\n长期偏好',
        source: {
          sections: [
            { name: 'tavern:constant-worldbook', text: '常驻条目' },
            { name: 'tavern:character-card', text: '人物设定' },
            { name: 'tavern:user-preference', text: '长期偏好' }
          ]
        }
      },
      { role: 'user', content: '变量已变更', source: { kind: 'plugin:dsh-tavern', form: 'variable-changes' } },
      { role: 'user', content: '写作规则注入', source: { kind: 'plugin:dsh-tavern', form: 'writing-rules' } },
      { role: 'user', content: '我推开门', source: { kind: 'user' } },
      { role: 'assistant', content: '开场白', source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' } },
      { role: 'assistant', content: '正文回复', source: { kind: 'model', provider: 'openai', model: 'gpt' } },
      { role: 'tool', content: '{"ok":true}', source: { kind: 'tool', callId: 'c1' } }
    ]
  }
  const byKey = Object.fromEntries(sections(request).map(s => [s.cacheKey, s.sources]))
  assert.deepEqual(byKey['field:system'], [{ category: 'system', label: '系统提示' }])
  assert.deepEqual(byKey['field:tools'], [{ category: 'tool', label: '工具定义' }])
  assert.deepEqual(byKey['msg:0'], [
    { category: 'worldbook', label: '常驻世界书' },
    { category: 'card', label: '人物卡' },
    { category: 'preset', label: '长期偏好' }
  ])
  assert.deepEqual(byKey['msg:1'], [{ category: 'state', label: '变量变更' }])
  assert.deepEqual(byKey['msg:2'], [{ category: 'plugin', label: '写作规则' }])
  assert.deepEqual(byKey['msg:3'], [{ category: 'story', label: '玩家输入' }])
  assert.deepEqual(byKey['msg:4'], [{ category: 'card', label: '人物卡开场白' }])
  assert.deepEqual(byKey['msg:5'], [{ category: 'story', label: '模型回复' }])
  assert.deepEqual(byKey['msg:6'], [{ category: 'tool', label: '工具结果' }])
})

test('上下文窗口模型：6 桶归类、最大余数法整数归一化及方案 C triggerState 状态判定', () => {
  const sampleRequest = {
    system: '系统指令说明',
    tools: [{ name: 'dice', description: '掷骰' }],
    messages: [
      { role: 'system', content: '常驻世界书内容', source: { sections: [{ name: 'tavern:constant-worldbook', text: '常驻世界书内容' }] } },
      { role: 'system', content: '角色卡设定', source: { sections: [{ name: 'tavern:character-card', text: '角色卡设定' }] } },
      { role: 'user', content: '主角状态变更', source: { kind: 'mod', form: 'variable-changes' } },
      { role: 'user', content: '玩家推门而入', source: { kind: 'user' } }
    ]
  }

  // 1) 健康状态 + 最大余数归一化求和严格相等
  const healthyRecord = {
    id: 'req-healthy',
    turn: 2,
    step: 1,
    scope: 'foreground',
    request: sampleRequest,
    cacheDiff: {
      compareStatus: 'compared',
      usage: { inputTokens: 1200, cacheReadTokens: 8500, cacheWriteTokens: 300, totalInputTokens: 10000, hitRate: 0.85 },
      sectionStatus: { 'field:system': 'hit', 'msg:3': 'appended' },
      breakPoint: null
    }
  }
  const s1 = structuredClone(client.buildContextWindowSummary(healthyRecord, {
    contextWindow: 100000,
    compactionPolicy: { mode: 'percent', percent: 80 },
    recentSeries: [{ id: 'r1', turn: 1, tokens: 8000 }, { id: 'r2', turn: 2, tokens: 10000 }]
  }))
  assert.equal(s1.measured, true)
  assert.equal(s1.usedTokens, 10000)
  assert.equal(s1.freeTokens, 90000)
  assert.equal(s1.items.reduce((sum, item) => sum + item.tokens, 0), 10000)
  assert.equal(s1.buckets.reduce((sum, bucket) => sum + bucket.tokens, 0), 10000)
  assert.equal(s1.health, 'healthy')
  assert.equal(s1.triggerState.tone, 'normal')
  assert.equal(s1.triggerState.percent, 10)
  assert.equal(s1.triggerState.alertPill, '')

  // 2) 缓存命中归 0 触发 cache-break 状态与 0% 告警微角标
  const cacheBreakRecord = {
    ...healthyRecord,
    cacheDiff: {
      compareStatus: 'compared',
      usage: { inputTokens: 9000, cacheReadTokens: 0, cacheWriteTokens: 1000, totalInputTokens: 10000, hitRate: 0 },
      sectionStatus: { 'msg:0': 'break' },
      breakPoint: { key: 'msg:0', title: 'Msg 0' },
      zeroReadReason: 'prefix-broken'
    }
  }
  const s2 = structuredClone(client.buildContextWindowSummary(cacheBreakRecord, {
    contextWindow: 100000,
    compactionPolicy: { mode: 'percent', percent: 80 }
  }))
  assert.equal(s2.health, 'warn')
  assert.equal(s2.triggerState.tone, 'cache-break')
  assert.equal(s2.triggerState.alertPill, '0%')
  assert.equal(s2.firstBreakKey, 'msg:0')

  // 3) 容量超出自动压缩阈值触发 danger 状态与百分比红角标
  const dangerRecord = {
    ...healthyRecord,
    cacheDiff: {
      compareStatus: 'compared',
      usage: { inputTokens: 8600, cacheReadTokens: 78000, cacheWriteTokens: 0, totalInputTokens: 86600, hitRate: 0.9 },
      sectionStatus: {}
    }
  }
  const s3 = structuredClone(client.buildContextWindowSummary(dangerRecord, {
    contextWindow: 100000,
    compactionPolicy: { mode: 'percent', percent: 80 }
  }))
  assert.equal(s3.health, 'danger')
  assert.equal(s3.triggerState.tone, 'danger')
  assert.equal(s3.triggerState.alertPill, '87%')
})

test('上下文窗口模型：Treemap 非线性分布与碎项合并及 400 格 Waffle 保底分配', () => {
  const summary = structuredClone(client.buildContextWindowSummary({
    id: 'req-map',
    turn: 5,
    request: {
      system: 'S'.repeat(200),
      tools: Array.from({ length: 10 }, (_, i) => ({ name: 'tool_' + i, desc: 'x' })),
      messages: Array.from({ length: 16 }, (_, i) => ({
        role: 'system',
        content: '世界书条目 #' + i + ' 内容详情',
        source: { sections: [{ name: 'tavern:constant-worldbook', text: '世界书条目 #' + i + ' 内容详情' }] }
      }))
    },
    cacheDiff: {
      compareStatus: 'compared',
      usage: { inputTokens: 10000, cacheReadTokens: 40000, cacheWriteTokens: 0, totalInputTokens: 50000, hitRate: 0.8 },
      sectionStatus: {}
    }
  }, { contextWindow: 100000 }))

  const map = structuredClone(client.computeContextMapTiles(summary, { width: 400, height: 140, maxTiles: 8 }))
  assert.ok(map.tiles.length >= 2)
  assert.ok(map.tiles.some(t => t.kind === 'free'), '包含斜纹剩余空间 tile')
  assert.ok(map.tiles.some(t => t.kind === 'group' && /另外 \d+ 项/.test(t.label)), '过多小项折叠为另外 N 项')
  for (const tile of map.tiles) {
    assert.ok(tile.x >= -0.01 && tile.y >= -0.01 && tile.x + tile.w <= 100.05 && tile.y + tile.h <= 100.05, 'Treemap 坐标在 [0,100] 内')
  }

  const cells = structuredClone(client.computeContextWaffleCells(summary, 400))
  assert.equal(cells.length, 400, 'Waffle 总格数严格等于 400')
  assert.ok(cells.some(c => c.bucket === 'tool'), '非零占比工具桶保底至少占 1 格')
})

test('maintenance.getLatestRequestContext 返回 meta 元信息、支持 scope 切换与精简依赖兜底', async () => {
  const { createMaintenanceHandlers } = await import('../tavern-plugin/lib/rpc/maintenance.js')
  const files = new Map()
  const storage = {
    readJson: async p => (files.has(p) ? JSON.parse(files.get(p)) : null),
    writeJson: async (p, v) => { files.set(p, JSON.stringify(v)) },
    writeBody: async (p, v, raw) => { files.set(p, raw ?? JSON.stringify(v)) },
    updateJson: async (p, fn) => {
      const next = fn(files.has(p) ? JSON.parse(files.get(p)) : undefined)
      files.set(p, JSON.stringify(next))
      return next
    }
  }
  const { createModelRequestLog } = await import('../tavern-plugin/lib/domain/model-request-log.js')
  let seq = 0
  const log = createModelRequestLog({ ...storage, id: () => 'r-' + (++seq) })
  const fg = await log.record({
    chat: { id: 'chat-m1' },
    context: { scope: 'foreground', task: 'reply', turn: 1 },
    coordinates: { turn: 1, step: 1 },
    options: { sessionId: 's-fg', provider: 'anthropic', model: 'claude-4-sonnet', system: 'sys', messages: [{ role: 'user', content: 'hi' }] }
  })
  await log.complete({ chatId: 'chat-m1', id: fg.id, text: 'hello', finish: { kind: 'stop' }, usage: { inputTokens: 1000, cacheReadTokens: 9000, cacheWriteTokens: 0 } })
  const bg = await log.record({
    chat: { id: 'chat-m1' },
    context: { scope: 'background', task: 'stage-director', turn: 1 },
    coordinates: { turn: 1, step: 1 },
    options: { sessionId: 's-bg', provider: 'openai', model: 'gpt-4o-mini', system: 'dir', messages: [{ role: 'user', content: 'dir' }] }
  })
  await log.complete({ chatId: 'chat-m1', id: bg.id, text: 'ok', finish: { kind: 'stop' }, usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } })

  const handlers = createMaintenanceHandlers({
    backgroundAgentRunner: { requestContext: () => null },
    sessionStore: { get: () => null },
    agentRegistry: { get: () => null },
    sessionStateForSession: async () => ({ id: 'chat-m1', sessionId: 's-fg' }),
    modelRequestLog: log,
    modelSelection: () => ({ provider: 'anthropic', model: 'claude-4-sonnet' }),
    readTavernSettings: async () => ({ contextCompaction: { mode: 'percent', percent: 75, rounds: 20, retainRounds: 10 } }),
    llm: {
      resolveModelInfo: async (provider, model) => ({
        context: { contextWindow: model === 'gpt-4o-mini' ? 128000 : 200000 }
      })
    },
    str: v => String(v ?? '')
  })

  const fgRes = await handlers.getLatestRequestContext({ sessionId: 's-fg', includeMeta: true })
  assert.equal(fgRes.record.id, fg.id)
  assert.equal(fgRes.meta.scope, 'foreground')
  assert.equal(fgRes.meta.contextWindow, 200000)
  assert.equal(fgRes.meta.compactionPolicy.percent, 75)
  assert.equal(fgRes.meta.hasBackground, true)
  assert.equal(fgRes.meta.recentSeries.length, 1)
  assert.equal(fgRes.meta.recentSeries[0].tokens, 10000)

  const bgRes = await handlers.getLatestRequestContext({ sessionId: 's-fg', scope: 'background', includeMeta: true })
  assert.equal(bgRes.record.id, bg.id)
  assert.equal(bgRes.meta.scope, 'background')
  assert.equal(bgRes.meta.contextWindow, 128000)
  assert.equal(bgRes.meta.recentSeries.length, 1)
  assert.equal(bgRes.meta.recentSeries[0].tokens, 500)

  // 缺失 llm / modelSelection / readTavernSettings 时稳健兜底
  const minimal = createMaintenanceHandlers({
    backgroundAgentRunner: { requestContext: () => null },
    sessionStore: { get: () => null },
    agentRegistry: { get: () => null },
    sessionStateForSession: async () => ({ id: 'chat-m1' }),
    modelRequestLog: log,
    str: v => String(v ?? '')
  })
  const minimalRes = await minimal.getLatestRequestContext({ sessionId: 's-fg' })
  assert.equal(minimalRes.record.id, fg.id)
  assert.equal(minimalRes.meta.contextWindow, null)
})
