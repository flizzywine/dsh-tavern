import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const presetSource = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')

test('正文直接生成成稿，不再进入第二轮精修', () => {
  assert.doesNotMatch(clientSource, /polish|精修/iu)
  assert.doesNotMatch(serverSource, /polish|精修|draftText|polishedText/iu)
  assert.doesNotMatch(presetSource, /polish|精修|draftText|polishedText/iu)
  assert.match(presetSource, /正文要直接写出成稿/)
  assert.match(presetSource, /写完后直接调用 action=commit/)
})
