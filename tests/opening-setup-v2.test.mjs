import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateOpeningSetupSpec, resolveOpeningSetup, compileOpeningTemplate, openingWorldbookEnabled, OPENING_TEMPLATE_CSP } from '../tavern-plugin/lib/domain/opening-setup.js'

async function specExample() {
  const spec = await readFile(new URL('../docs/specs/opening-setup-v2.md', import.meta.url), 'utf8')
  const block = spec.slice(spec.indexOf('## 9.')).match(/```json\n([\s\S]*?)\n```/)[1]
  return { block, value: JSON.parse(block) }
}

// Labels are Chinese, keys are ASCII and never equal them.
const contract = () => ({
  version: 2,
  fields: [
    { key: 'name', type: 'name', label: '你的称呼' },
    { key: 'wish', type: 'text', label: '契约之愿', required: true, variable: 'PC.契约之愿' },
    { key: 'city', type: 'choice', label: '初始城市', variable: 'PC.当前位置', options: [
      { value: '东港市', label: '东港市（标准契约区）', text: '描写初次成为守护者的瞬间。' },
      { value: '西岭市', label: '西岭市（高危异常区）', text: '' }] },
    { key: 'arc', type: 'choice', label: '剧情章节', when: { city: '西岭市' }, options: [
      { value: '第一部', text: '神滨第一部的日常。' },
      { value: '第二部', text: '长夜之后。', scriptStart: { chunk: 3 } }] },
    { key: 'district', type: 'choice', label: '分区', when: { city: '西岭市' }, variables: { 'PC.当前位置': '西岭市-{district}' }, options: ['新西区', '北区'] }
  ],
  message: { type: 'LAUNCH', user_profile: { 姓名: '{name}', 章节: '{arc|不适用}', 体力值: 100 }, guidelines: '{city.text}{arc.text}' }
})

test('the spec example validates and stays within the authoring budget it states', async () => {
  const { block, value } = await specExample()
  assert.equal(validateOpeningSetupSpec(value), value)
  const lines = block.split('\n').length
  assert.ok(lines <= 20, lines + ' lines')
  const doc = await readFile(new URL('../docs/specs/opening-setup-v2.md', import.meta.url), 'utf8')
  assert.match(doc, new RegExp(lines + ' 行，UTF-8 ' + Buffer.byteLength(block).toLocaleString('en').replace(',', ' ') + ' 字节'))
  const story = resolveOpeningSetup(value, { name: '小林', stage: '结局之后', bond: 65 }, { userName: '你' })
  assert.deepEqual(story.scriptStart, { mode: 'story' })
  assert.deepEqual(story.variables, { '剧情.阶段': '结局之后', '好感.露娜': 65 })
  assert.match(story.message, /开局：后日谈。小林和露娜的关系：最在意的人/)
})

test('unknown types, duplicate keys, forward when and missing slots are rejected with a readable reason', () => {
  const bad = [
    [{ version: 2, fields: [{ key: 'a', type: 'date', label: '日期' }], message: 'x' }, /type「date」不受支持/],
    [{ version: 2, fields: [{ key: 'a', type: 'text', label: '甲' }, { key: 'a', type: 'text', label: '乙' }], message: 'x' }, /key「a」重复/],
    [{ version: 2, fields: [{ key: 'a', type: 'text', label: '甲', when: { b: 1 } }, { key: 'b', type: 'toggle', label: '乙' }], message: 'x' }, /只能引用它前面的字段/],
    [{ version: 2, fields: [{ key: 'a', type: 'text', label: '甲' }], message: '{b}' }, /不存在的字段 \{b\}/],
    [{ version: 2, fields: [{ key: 'a', type: 'text', label: '甲' }], message: 'x', form: '<form>' }, /不认识「form」/],
    [{ version: 2, fields: [{ key: 'a', type: 'text', label: '甲' }], message: 'x', template: '<p>无插槽</p>' }, /恰好放一次 <dsh-field key="a">/],
    [{ version: 2, fields: [{ key: 'a', type: 'choice', label: '甲', options: [{ value: 1, image: 'https://example.com/a.png' }] }], message: 'x' }, /图片只能是/],
    [{ version: 2, fields: [{ key: 'a', type: 'choice', label: '甲', options: [{ value: 1, scriptStart: { chunk: 0 } }] }], message: 'x' }, /剧本起点/]
  ]
  for (const [spec, reason] of bad) assert.throws(() => validateOpeningSetupSpec(spec), reason)
  assert.ok(validateOpeningSetupSpec(contract()))
})

test('submit: {{user}} default, option text, hidden fields write nothing, MVU paths and typed JSON leaves', () => {
  const spec = contract()
  const outside = resolveOpeningSetup(spec, { wish: '想要勇气', city: '东港市', arc: '第二部', district: '北区' }, { userName: '小林' })
  assert.equal(outside.playerName, '小林')
  assert.deepEqual(outside.variables, { 'PC.契约之愿': '想要勇气', 'PC.当前位置': '东港市' })
  assert.equal(outside.scriptStart, undefined, 'a hidden field contributes no branch')
  assert.deepEqual(JSON.parse(outside.message), { type: 'LAUNCH', user_profile: { 姓名: '小林', 章节: '不适用', 体力值: 100 }, guidelines: '描写初次成为守护者的瞬间。' })
  const inside = resolveOpeningSetup(spec, { name: '环彩羽', wish: '找回妹妹', city: '西岭市', arc: '第二部', district: '北区' }, { userName: '小林' })
  assert.equal(inside.playerName, '环彩羽')
  assert.deepEqual(inside.variables, { 'PC.契约之愿': '找回妹妹', 'PC.当前位置': '西岭市-北区' })
  assert.deepEqual(inside.scriptStart, { chunk: 3 })
  assert.equal(JSON.parse(inside.message).guidelines, '长夜之后。')
  assert.throws(() => resolveOpeningSetup(spec, { city: '东港市' }), /「契约之愿」还没填/)
  assert.throws(() => resolveOpeningSetup(spec, { wish: 'x', city: '东京' }), /「初始城市」的选项不存在/)
})

test('point budgets, sliders, multi selections and world-book prefixes resolve as declared', () => {
  const spec = { version: 2, fields: [
    { type: 'group', label: '天赋分配', points: 5 },
    { key: 'speed', type: 'slider', label: '手速', min: 1, max: 5, variable: '属性.手速' },
    { key: 'sense', type: 'slider', label: '意识', min: 1, max: 5, variable: '属性.意识' },
    { key: 'gifts', type: 'multi', label: '稀有能力', max: 2, variable: '主角.特殊能力', options: [{ value: '蛇佬腔', text: '能与蛇交谈。' }, '易容'] },
    { key: 'night', type: 'toggle', label: '扣扣规则', text: '改为荒诞喜剧。' },
    { key: 'route', type: 'choice', label: '时间线', options: [{ value: 'one', label: '一周目', worldbook: { '1️⃣': true, '2️⃣': false } }, { value: 'after', label: '后日谈', worldbook: { '1️⃣': false, '2️⃣': true, '后日谈 - 高': true } }] }
  ], message: '{gifts.label}|{gifts.text}|{night}{night.text}|{route.label}' }
  validateOpeningSetupSpec(spec)
  const resolved = resolveOpeningSetup(spec, { speed: 4, sense: 3, gifts: ['蛇佬腔'], night: true, route: 'after' })
  assert.deepEqual(resolved.variables, { '属性.手速': 4, '属性.意识': 3, '主角.特殊能力': ['蛇佬腔'] })
  assert.equal(resolved.message, '蛇佬腔|能与蛇交谈。|是改为荒诞喜剧。|后日谈')
  assert.equal(openingWorldbookEnabled('后日谈 - 高一事件', resolved.worldbook), true)
  assert.equal(openingWorldbookEnabled('1️⃣角色详情 - 艾玛', resolved.worldbook), false)
  assert.equal(openingWorldbookEnabled('创作准则[mvu_plot]', resolved.worldbook), undefined)
  assert.throws(() => resolveOpeningSetup(spec, { speed: 5, sense: 3 }), /最多分配 5 点（现在 6 点）/)
  assert.throws(() => resolveOpeningSetup(spec, { speed: 2.5 }), /按 1 递增/)
})

test('a hostile template compiles to inert markup under the exact CSP', () => {
  const template = [
    '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/x.css"></head><body>',
    '<script>window.__pwned = 1</script><SCRIPT src="https://evil.example/x.js"></SCRIPT>',
    '<img src=x onerror="window.__pwned=2"><img/src=x/onerror=alert(1)><svg onload=alert(1)><script>alert(1)</script></svg>',
    '<a href="javascript:alert(1)">x</a><a href="  jav&#x61;script:alert(1)">y</a><a href="https://evil.example" target="_top">z</a><a href="#ok">ok</a>',
    '<form action="https://evil.example"><button formaction="https://evil.example">go</button></form>',
    '<iframe srcdoc="<script>parent.__pwned=3</script>"></iframe><object data="x"></object><embed src="x">',
    '<style>@import url(https://evil.example/a.css); .x{background:url(https://evil.example/t.png)} .y{background:url(data:image/png;base64,AAAA)}</style>',
    '<p style="background:url(https://evil.example/s.png)">{{user}} &lt;b&gt;</p><dsh-field key="a"></dsh-field><dsh-start>开始</dsh-start>',
    '<!-- <script>alert(1)</script> --><img src="data:image/png;base64,AAAA" alt="ok"><img src=x onerror=alert(1)',
    '</body></html>'
  ].join('\n')
  const spec = { version: 2, fields: [{ key: 'a', type: 'text', label: '甲' }], message: '{a}', template, theme: { accent: '#e8578f' } }
  validateOpeningSetupSpec(spec)
  const html = compileOpeningTemplate(spec, { userName: '<b>小林</b>' })
  const body = html.slice(html.indexOf('<body'))
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy" content="' + OPENING_TEMPLATE_CSP + '">'))
  assert.equal(OPENING_TEMPLATE_CSP.includes("script-src 'none'"), true)
  assert.doesNotMatch(html, /<script|<iframe|<object|<embed|<form|<base|<link|http-equiv="refresh"/i)
  assert.doesNotMatch(body, /<[^>]*\son\w+\s*=/i, 'no event handler attribute survives')
  assert.doesNotMatch(body, /<meta/i)
  assert.doesNotMatch(html, /javascript:|evil\.example/i)
  assert.doesNotMatch(body, /target=/i)
  assert.match(body, /<a href="#ok">ok<\/a>/)
  assert.match(body, /<img src="data:image\/png;base64,AAAA" alt="ok">/)
  assert.match(body, /&lt;b&gt;小林&lt;\/b&gt;/, '{{user}} is escaped')
  assert.match(body, /<dsh-field key="a"><\/dsh-field><dsh-start>开始<\/dsh-start>/)
  assert.match(html, /url\(data:image\/png;base64,AAAA\)/)
  assert.match(html, /--dsh-opening-accent:#e8578f/)
})
