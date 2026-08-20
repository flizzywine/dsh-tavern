import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanWorkspaceCardMacros } from '../tavern-plugin/lib/domain/card-macros.js'

test('工作区人物卡删除宏与 HTML 整段，并替换角色占位符', () => {
  const cleaned = cleanWorkspaceCardMacros({
    name: '角色',
    description: '<div>{{setvar::status::必须更新}}</div><b>你好 {{char}}</b>普通正文：{{char}}。',
    first_mes: '{{user}} 来到门前。<br>抬头看门。',
    character_book: { entries: [{ content: '<section>设定 {{random::甲::乙}}</section>' }] }
  })
  assert.equal(cleaned.description, '普通正文：角色。')
  assert.equal(cleaned.first_mes, '玩家 来到门前。抬头看门。')
  assert.equal(cleaned.character_book.entries[0].content, '')
  assert.doesNotMatch(JSON.stringify(cleaned), /\{\{|<\/?[a-z]/i)
})

test('清理不修改传入的原版对象', () => {
  const original = { name: '角色', system_prompt: '{{setvar::rule::正文}}' }
  cleanWorkspaceCardMacros(original)
  assert.equal(original.system_prompt, '{{setvar::rule::正文}}')
})
