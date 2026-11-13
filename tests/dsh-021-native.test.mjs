import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { patchThemeFontLimit } from '../bin/theme-font-limit.mjs'
import { patchChatAnswerStep, patchChatSource } from '../bin/chat-answer-step-patch.mjs'
import { installHostSubprocessPatch } from '../tavern-plugin/lib/domain/host-subprocess-patch.js'

const native = { skip: !process.env.DSH_BOOT_MODULE }

async function restorePristineFontLimit(directory) {
  for (const name of ['index.js', 'client.js']) {
    const file = path.join(directory, 'lib', name)
    const code = await readFile(file, 'utf8')
    await writeFile(file, code
      .replace('const FONT_SIZE_MAX = 32;', 'const FONT_SIZE_MAX = 22;')
      .replace(/(variable\s*:\s*(["'`])--dsh-content-font-size\2\s*,\s*min\s*:\s*10\s*,\s*max\s*:\s*)32(\s*,)/, '$122$3'))
  }
}

test('目标宿主字号补丁只扩大正文字号，重复安装幂等，锚点不符时跳过且不写入', native, async t => {
  const require = createRequire(process.env.DSH_BOOT_MODULE)
  const source = path.dirname(require.resolve('@deepseek-ai/dsh-client-ui-theme/package.json'))
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-theme-native-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await cp(source, directory, { recursive: true })
  // A host installed through Tavern is already patched; start every run from the pristine anchors.
  await restorePristineFontLimit(directory)
  assert.equal(patchThemeFontLimit(directory), true)
  assert.equal(patchThemeFontLimit(directory), false)
  for (const name of ['index.js', 'client.js']) {
    const code = await readFile(path.join(directory, 'lib', name), 'utf8')
    assert.match(code, /variable\s*:\s*(["'`])--dsh-content-font-size\1\s*,\s*min\s*:\s*10\s*,\s*max\s*:\s*32\s*,/)
    assert.match(code, /variable\s*:\s*(["'`])--dsh-code-font-size\1\s*,\s*min\s*:\s*10\s*,\s*max\s*:\s*16\s*,/)
    assert.match(code, /variable\s*:\s*(["'`])--dsh-terminal-font-size\1\s*,\s*min\s*:\s*10\s*,\s*max\s*:\s*20\s*,/)
  }
  await cp(source, directory, { recursive: true })
  await restorePristineFontLimit(directory)
  const client = path.join(directory, 'lib/client.js')
  const host = path.join(directory, 'lib/index.js')
  const originalHost = await readFile(host, 'utf8')
  const drifted = (await readFile(client, 'utf8')).replace(/(variable\s*:\s*(["'`])--dsh-content-font-size\2\s*,\s*min\s*:\s*10\s*,\s*max\s*:\s*)22(\s*,)/, '$123$3')
  await writeFile(client, drifted)
  assert.equal(patchThemeFontLimit(directory), null)
  assert.equal(await readFile(host, 'utf8'), originalHost)
  assert.equal(await readFile(client, 'utf8'), drifted)
})

test('目标宿主 Windows 子进程补丁可安装、共享并恢复，宿主文件不变', native, async () => {
  const require = createRequire(process.env.DSH_BOOT_MODULE)
  const { pathToFileURL } = await import('node:url')
  const entry = require.resolve('@deepseek-ai/dsh-subprocess-local')
  const { default: Local } = await import(pathToFileURL(entry).href)
  const before = await readFile(entry, 'utf8')
  const original = Local.prototype.spawn
  const restore = await installHostSubprocessPatch({ hostRequire: require, platform: 'win32' })
  try {
    assert.notEqual(Local.prototype.spawn, original)
    const second = await installHostSubprocessPatch({ hostRequire: require, platform: 'win32' })
    second()
    assert.notEqual(Local.prototype.spawn, original)
    assert.equal(await readFile(entry, 'utf8'), before)
  } finally { restore() }
  assert.equal(Local.prototype.spawn, original)
})

test('目标宿主对话界面补丁：末尾只有替换的编辑步骤不再让整轮被当作过程，其他回合不变；重复安装幂等，形状不符时跳过', native, async t => {
  const require = createRequire(process.env.DSH_BOOT_MODULE)
  const source = path.dirname(require.resolve('@deepseek-ai/dsh-client-ui-chat/package.json'))
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-chat-native-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await cp(source, directory, { recursive: true })
  const client = path.join(directory, 'lib', 'client.js')
  const pristine = await readFile(client, 'utf8')
  // A host installed through Tavern is already patched; that counts as installed.
  const patchedBefore = pristine.includes('dsh-tavern:answer-step')
  assert.equal(patchChatAnswerStep(directory), !patchedBefore)
  assert.equal(patchChatAnswerStep(directory), false)
  const code = await readFile(client, 'utf8')
  // Run the patched function against Turn shapes; the two helpers mirror the host's own.
  const body = code.match(/function latestAnswer\(turn\) \{[\s\S]*?\n\t\t\}/)[0]
  const latestAnswer = new Function('isFinalAssistant', 'hasAssistantReplyContent', body + '\nreturn latestAnswer')(
    data => data?.finalNode !== undefined,
    blocks => blocks.some(block => block.kind === 'text' && block.text.trim() !== ''))
  const step = data => ({ data: new Map(data === undefined ? [] : [['assistant-step', data]]) })
  const answer = { step: 1, finalNode: { seq: 7 }, blocks: [{ kind: 'reasoning', text: '想' }, { kind: 'text', text: '正文' }] }
  assert.equal(latestAnswer({ steps: [step(answer)] }), answer, 'ordinary single-step turn')
  assert.equal(latestAnswer({ steps: [step(answer), step({ step: 2, blocks: [] })] }), answer, 'settled reply rewritten in its own edit step')
  assert.equal(latestAnswer({ steps: [step(answer), step(undefined)] }), answer, 'trailing step without assistant data')
  const toolStep = { step: 1, finalNode: { seq: 3 }, blocks: [{ kind: 'tool-call' }] }
  const final = { step: 2, finalNode: { seq: 9 }, blocks: [{ kind: 'text', text: '最后' }] }
  assert.equal(latestAnswer({ steps: [step(toolStep), step(final)] }), final, 'tool turn keeps its real last step')
  assert.equal(latestAnswer({ steps: [step(final), step(toolStep)] }), null, 'a trailing tool call is still not an answer')
  assert.equal(latestAnswer({ steps: [] }), null, 'turn without steps')
  // A chat view that no longer reads the last step is left untouched.
  const drifted = pristine.replace(/function latestAnswer\(turn\) \{[\s\S]*?\n\t\t\}/, 'function latestAnswer(turn) {\n\t\t\treturn null;\n\t\t}')
  await writeFile(client, drifted)
  assert.equal(patchChatAnswerStep(directory), null)
  assert.equal(await readFile(client, 'utf8'), drifted)
})

test('对话界面补丁不绑定宿主原文：改了缩进、换行、参数名或周围代码仍能打上', () => {
  for (const source of [
    'function latestAnswer(turn) {\n\tconst data = turn.steps.at(-1)?.data.get("assistant-step");\n}',
    'function latestAnswer( t ){\r\n    let d = t.steps.at( -1 ); if (!d) return null;\r\n}',
    'x();function latestAnswer($t){const a=1;return $t.steps.at(-1)?.data}function y(){}',
  ]) {
    const result = patchChatSource(source)
    assert.equal(result.status, 'applied', source)
    assert.doesNotMatch(result.text, /function latestAnswer[^}]*\.steps\.at\(\s*-1\s*\)\?/)
    assert.equal(patchChatSource(result.text).status, 'patched')
  }
  // Another function reading the last step is not touched.
  assert.equal(patchChatSource('function latestAnswer(turn) { return turn.answer }\nfunction other(turn) { return turn.steps.at(-1) }').status, 'unmatched')
})
