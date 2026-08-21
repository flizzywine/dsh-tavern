import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCardMacros, projectCardText } from '../tavern-plugin/lib/domain/card-macros.js'

test('加载文本时剥掉普通双花括号并删除命令宏', () => {
  assert.equal(
    projectCardText('{{char}} 看向 {{ user }}。{{setvar::combat_driver::}}{{getvar::combat_driver}}'),
    'char 看向 user。'
  )
})

test('人物卡投影不修改原始对象', () => {
  const card = { description: '{{char}}', alternate_greetings: ['{{user}}', '{{random::甲::乙}}'] }
  const projected = projectCardMacros(card)
  assert.deepEqual(projected, { description: 'char', alternate_greetings: ['user', ''] })
  assert.deepEqual(card, { description: '{{char}}', alternate_greetings: ['{{user}}', '{{random::甲::乙}}'] })
})
