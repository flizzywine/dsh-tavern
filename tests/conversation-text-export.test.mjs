import assert from 'node:assert/strict'
import test from 'node:test'

import { createConversationTextExport } from '../tavern-plugin/lib/domain/conversation-text-export.js'

test('游玩对话导出为横线分隔的纯文本，并包含开场白', () => {
  const result = createConversationTextExport({
    title: '',
    mode: 'story',
    cardName: '阿芙拉',
    macroState: { userName: '陈锋' },
    messages: [
      { role: 'assistant', text: '雨水敲着窗。', greeting: true },
      { role: 'user', text: '我推开酒馆的门。' },
      { role: 'assistant', text: '她抬起头。\n\n<style>.panel{color:red}</style><div class="panel">状态面板</div>', sourceText: '不应导出原始模型消息', displayText: '<div>不应导出展示投影</div>' }
    ]
  }, { title: '雨夜酒馆' })

  assert.equal(result.filename, '雨夜酒馆.txt')
  assert.equal(result.messageCount, 3)
  assert.equal(result.text, '雨水敲着窗。\n\n------------------------------------------------------------\n\n我推开酒馆的门。\n\n------------------------------------------------------------\n\n她抬起头。\n')
  assert.doesNotMatch(result.text, /阿芙拉：|陈锋：/)
  assert.doesNotMatch(result.text, /状态面板|sourceText|原始模型消息|展示投影/)
})

test('整轮 HTML 安全转换为可见纯文本，不执行或导出前端代码', () => {
  const result = createConversationTextExport({
    messages: [{
      role: 'assistant',
      text: '<!doctype html><html><head><title>内部标题</title><style>.secret{display:none}</style><script>window.bad = true</script></head><body><maintext><p>第一段 &amp; 正文</p><p>第二段<br>继续</p></maintext><!-- 内部注释 --></body></html>'
    }]
  })

  assert.equal(result.text, '第一段 & 正文\n\n第二段\n继续\n')
  assert.doesNotMatch(result.text, /doctype|html|head|style|script|window\.bad|内部标题|内部注释|maintext|<|>/i)
})

test('自定义人物卡标签只移除标签本身，并保留其中的可见文本', () => {
  const result = createConversationTextExport({
    messages: [{
      role: 'assistant',
      text: '<avra_status>时间：16:47</avra_status>\n<maintext>雨水敲着窗。\n\n阿芙拉抬起头。</maintext>'
    }]
  })

  assert.equal(result.text, '时间：16:47\n\n雨水敲着窗。\n\n阿芙拉抬起头。\n')
  assert.doesNotMatch(result.text, /avra_status|maintext|<|>/)
})

test('普通文本中的大小比较符不会被误判为 HTML 标签', () => {
  const result = createConversationTextExport({
    messages: [{ role: 'assistant', text: '好感度 < 5，阶段值 > 3。' }]
  })

  assert.equal(result.text, '好感度 < 5，阶段值 > 3。\n')
})

test('卡片工作台同样只导出正文，并过滤内部消息、空消息与非法文件名字符', () => {
  const result = createConversationTextExport({
    mode: 'card',
    cardName: '草稿人物卡',
    messages: [
      { role: 'system', text: '系统提示' },
      { role: 'user', text: '  帮我修改性格。  ' },
      { role: 'assistant', text: '已经修改。' },
      { role: 'tool', text: '工具结果' },
      { role: 'assistant', text: '   ' }
    ]
  }, { title: '人物卡：修改/测试?' })

  assert.equal(result.filename, '人物卡：修改 测试.txt')
  assert.equal(result.messageCount, 2)
  assert.equal(result.text, '帮我修改性格。\n\n------------------------------------------------------------\n\n已经修改。\n')
  assert.doesNotMatch(result.text, /用户：|助手：/)
})

test('没有可见对话时返回空导出结果', () => {
  assert.deepEqual(createConversationTextExport({ messages: [{ role: 'system', text: '内部信息' }] }), {
    filename: '对话记录.txt',
    text: '',
    messageCount: 0
  })
})
