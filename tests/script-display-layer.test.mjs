import assert from 'node:assert/strict'
import test from 'node:test'

import { fencedSegments } from '../tavern-plugin/lib/domain/html-fenced-segments.js'

test('未标语言的代码块按 JS-Slash-Runner 规则：只有完整页面才渲染，<msg> 等协议片段保留为代码块', () => {
  assert.deepEqual(fencedSegments('前文\n```\n<msg>胡伟|顾绒绒|你好|09:00</msg>\n```\n').map(part => part.kind), ['text'])
  assert.deepEqual(fencedSegments('```\n<html><body>面板</body></html>\n```').map(part => part.kind), ['html'])
  assert.deepEqual(fencedSegments('```html\n<div>状态</div>\n```').map(part => part.kind), ['html'])
})
