import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL('../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')

test('the template frame is sandboxed to same-origin only and the page keeps its controls', async () => {
  const source = await read('features/opening-setup-template.js')
  assert.match(source, /const OPENING_TEMPLATE_SANDBOX = "allow-same-origin";/)
  assert.doesNotMatch(source, /allow-scripts|allow-forms|allow-popups|allow-top-navigation/)
  assert.match(source, /sandbox: OPENING_TEMPLATE_SANDBOX/)
  assert.match(source, /ReactDOM\.createPortal\(props\.control\(fields\.get\(entry\[0\]\), true\)/, 'slots get the form\'s own controls')
})

test('<dsh-value> reads the value, the option label or its text like the host message', async () => {
  const context = vm.createContext({})
  vm.runInContext(await read('features/opening-setup-form.js') + '\n' + await read('features/opening-setup-template.js'), context)
  const city = { key: 'city', type: 'choice', label: '城市', options: [{ value: 'b', label: '西岭市', text: '高危异常区' }] }
  const gifts = { key: 'gifts', type: 'multi', label: '能力', options: [{ value: 'snake', label: '蛇佬腔', text: '能与蛇交谈' }, '易容'] }
  const night = { key: 'night', type: 'toggle', label: '扣扣', text: '改为喜剧' }
  assert.equal(context.openingTemplateValueText(city, 'b', null), 'b')
  assert.equal(context.openingTemplateValueText(city, 'b', 'label'), '西岭市')
  assert.equal(context.openingTemplateValueText(city, 'b', 'text'), '高危异常区')
  assert.equal(context.openingTemplateValueText(gifts, ['snake', '易容'], 'label'), '蛇佬腔、易容')
  assert.equal(context.openingTemplateValueText(gifts, ['snake'], 'text'), '能与蛇交谈')
  assert.equal(context.openingTemplateValueText(night, true, 'text'), '改为喜剧')
  assert.equal(context.openingTemplateValueText(night, false, null), '否')
})
