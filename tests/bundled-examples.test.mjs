import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverUrl = new URL('../tavern-plugin/lib/index.js', import.meta.url)
const presetUrl = new URL('../tavern-plugin/examples/presets/Kemini%20Dramatron%20%E9%99%A8%E8%90%BD%E7%9A%84%E5%A4%A9%E6%89%8Dv1.26.json', import.meta.url)
const selectionUrl = new URL('../tavern-plugin/examples/bypass-plans/Kemini%20Dramatron%20%E9%99%A8%E8%90%BD%E7%9A%84%E5%A4%A9%E6%89%8Dv1.26%20%C2%B7%20%E7%A0%B4%E9%99%90%E6%96%B9%E6%A1%88.json', import.meta.url)

test('发布包不再内置或自动安装外部预设及其运行配置', async function () {
  const serverSource = await readFile(serverUrl, 'utf8')
  assert.doesNotMatch(serverSource, /createBundledExampleInstaller|bundledExamples\.install/)
  await assert.rejects(readFile(presetUrl, 'utf8'), { code: 'ENOENT' })
  await assert.rejects(readFile(selectionUrl, 'utf8'), { code: 'ENOENT' })
})
