import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

test('阿芙拉公开演示以展示正则美化开场，同时保持 Session 原文', async () => {
  const source = await readFile(new URL('../demo/cards/avra-complete.json', import.meta.url), 'utf8')
  const card = JSON.parse(source)
  const regexScripts = inspectCardExtensions(card).regexScripts
  const opening = card.data.first_mes
  const result = projectReplyLayers(opening, { regexScripts, placement: 2 })

  assert.equal(card.data.name, '阿芙拉')
  assert.equal(regexScripts.length, 1)
  assert.equal(result.sessionText, opening)
  assert.equal(result.applied.session.length, 0)
  assert.deepEqual(result.applied.display.map(item => item.name), ['金麦穗酒馆状态面板'])
  assert.match(result.displayText, /class="avra-panel"/)
  assert.match(result.displayText, /金麦穗酒馆/)
  assert.doesNotMatch(result.displayText, /<avra_status>/)
  assert.deepEqual(result.warnings, [])
})
