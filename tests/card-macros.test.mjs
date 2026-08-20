import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanWorkspaceCardMacros } from '../tavern-plugin/lib/domain/card-macros.js'

test('工作区人物卡清理宏、替换角色占位符并完整保留 HTML', () => {
  const cleaned = cleanWorkspaceCardMacros({
    name: '角色',
    description: '<div>{{setvar::status::必须更新}}</div><b>你好 {{char}}</b>普通正文：{{char}}。',
    first_mes: '{{user}} 来到门前。<br>抬头看门。',
    character_book: { entries: [{ content: '<section>设定 {{random::甲::乙}}</section>' }] }
  })
  assert.equal(cleaned.description, '<div></div><b>你好 角色</b>普通正文：角色。')
  assert.equal(cleaned.first_mes, '玩家 来到门前。<br>抬头看门。')
  assert.equal(cleaned.character_book.entries[0].content, '<section>设定 </section>')
  assert.doesNotMatch(JSON.stringify(cleaned), /\{\{/)
  assert.match(JSON.stringify(cleaned), /<b>你好 角色<\/b>|<section>设定 <\/section>/)
})

test('清理不修改传入的原版对象', () => {
  const original = { name: '角色', system_prompt: '{{setvar::rule::正文}}' }
  cleanWorkspaceCardMacros(original)
  assert.equal(original.system_prompt, '{{setvar::rule::正文}}')
})
