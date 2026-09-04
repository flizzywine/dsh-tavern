import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createResourceWorkspaceProjection } from '../tavern-plugin/lib/domain/resource-workspace-projection.js'

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

test('发布资源规范、全局绑定和会话隔离的上下文与诊断投影', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-workspace-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const projection = createResourceWorkspaceProjection({ root, now: () => 123456 })

  const result = await projection.publish({
    sessionId: 'session/card:1',
    context: {
      schema: '伪造值', sessionId: '伪造值', chatId: 'chat-editor', mode: 'card', card: { path: 'cards/原卡.json', name: '原卡' },
      mountedResources: [{ kind: 'card', path: 'cards/原卡.json', label: '原卡' }]
    },
    bindings: [{
      card: { path: 'cards/原卡.json', name: '原卡' },
      script: { path: 'materials/原作.md' },
      worldbook: { kind: 'standalone', path: 'worldbooks/设定.json', available: true }
    }],
    diagnostics: [{
      ref: 'play-chat:chat-play', turn: 3, status: 'available',
      overview: '第 3 轮可读', authorization: 'Bearer should-not-leak'
    }]
  })

  assert.equal(result.specPath, '.tavern/README.md')
  assert.equal(result.bindingsPath, '.tavern/bindings.json')
  assert.match(result.contextPath, /^\.tavern\/sessions\/[a-f0-9]{24}\/context\.json$/)
  assert.equal(result.diagnosticsPath, result.contextPath.replace(/context\.json$/, 'diagnostics.json'))

  const readme = await readFile(path.join(root, result.specPath), 'utf8')
  assert.match(readme, /由 Tavern 生成/)
  assert.match(readme, /不要把这些投影当成聊天历史/)
  assert.match(readme, /cards\//)
  assert.match(readme, /worldbooks\//)

  const bindings = await json(path.join(root, result.bindingsPath))
  assert.equal(bindings.schema, 'dsh-tavern.resource-bindings')
  assert.equal(bindings.generatedAt, 123456)
  assert.equal(bindings.cards[0].worldbook.path, 'worldbooks/设定.json')

  const context = await json(path.join(root, result.contextPath))
  assert.equal(context.schema, 'dsh-tavern.session-context')
  assert.equal(context.sessionId, 'session/card:1')
  assert.equal(context.card.path, 'cards/原卡.json')
  assert.equal(context.files.diagnostics, result.diagnosticsPath)

  const diagnostics = await json(path.join(root, result.diagnosticsPath))
  assert.equal(diagnostics.schema, 'dsh-tavern.session-diagnostics')
  assert.equal(diagnostics.items[0].authorization, '[已隐藏]')
  assert.equal(diagnostics.items[0].overview, '第 3 轮可读')
})

test('不同 Session 不会互相覆盖上下文和诊断', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-workspace-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const projection = createResourceWorkspaceProjection({ root, now: () => 1 })

  const first = await projection.publish({ sessionId: 'session-a', context: { card: { path: 'cards/A.json' } } })
  const second = await projection.publish({ sessionId: 'session-b', context: { card: { path: 'cards/B.json' } } })

  assert.notEqual(first.contextPath, second.contextPath)
  assert.equal((await json(path.join(root, first.contextPath))).card.path, 'cards/A.json')
  assert.equal((await json(path.join(root, second.contextPath))).card.path, 'cards/B.json')
})
