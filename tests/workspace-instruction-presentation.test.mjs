import assert from 'node:assert/strict'
import test from 'node:test'

const message = (source, text = 'AGENTS.md instruction') => ({ role: 'user', source, content: [{ type: 'text', text }] })

import { installWorkspaceInstructionPresentation } from '../tavern-plugin/lib/domain/workspace-instruction-presentation.js'

import { markRequestHandled, requestHandledBy } from '../tavern-plugin/lib/domain/request-lineage.js'

// A minimal llm/stream middleware chain: stream() always enters at the first hook.
function middleware() {
  const hooks = []
  const sent = []
  const ctx = {
    on(event, hook) { hooks.push(hook) },
    llm: { stream(request) {
      const run = index => index < hooks.length ? hooks[index](request, () => run(index + 1))
        : (async function * () { sent.push(request); yield { type: 'finish', reason: { kind: 'stop' } } })()
      return run(0)
    } }
  }
  return { ctx, sent }
}
const blocked = () => message({ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', sections: [{ name: 'approval:policy', text: 'never' }, { name: 'keep', text: 'context' }] })

test('re-dispatching hooks converge on each other\'s copies (issue #146)', async () => {
  const { ctx, sent } = middleware()
  let projections = 0
  // A projection that rebuilds the request and re-adds a filterable section every time:
  // with identity-only guards this and workspace presentation re-dispatched forever.
  ctx.on('llm/stream', (request, next) => {
    if (requestHandledBy(request, 'test-projection')) return next()
    projections++
    assert.ok(projections < 5, 'projection must not re-run on its own descendants')
    return ctx.llm.stream(markRequestHandled({ ...request, messages: [...request.messages, blocked()] }, 'test-projection'))
  })
  installWorkspaceInstructionPresentation(ctx, async () => true)
  for await (const _ of ctx.llm.stream({ sessionId: 's', messages: [blocked()] })) { /* drain */ }
  assert.equal(projections, 1)
  assert.equal(sent.length, 1)
  assert.equal(JSON.stringify(sent[0]).includes('approval'), false)
  // The lineage mark is a symbol: it never reaches a provider payload.
  assert.equal(Object.keys(sent[0]).some(key => key.includes('handled')), false)
})
