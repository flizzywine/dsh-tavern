import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// README 与使用文档各自手写下载链接，曾出现 README 已换修复版、文档站仍指向旧安装器的漂移。
test('README 与使用文档指向同一个 Windows 安装器', async () => {
  const files = ['README.md', 'docs/installation.md', 'docs/manual/introduction.mjs']
  const names = new Set()
  for (const file of files) {
    const text = await readFile(new URL('../' + file, import.meta.url), 'utf8')
    for (const match of text.matchAll(/DSH-Tavern-Desktop-[\w.-]+-Setup[\w.-]*\.exe/g)) names.add(match[0])
  }
  assert.deepEqual([...names], [], '官方宿主分支不得继续推广旧社区宿主安装包')
})
