import assert from 'node:assert/strict'
import test from 'node:test'

const message = (source, text = 'AGENTS.md instruction') => ({ role: 'user', source, content: [{ type: 'text', text }] })

import { installWorkspaceInstructionPresentation, presentWorkspaceInstructions } from '../tavern-plugin/lib/domain/workspace-instruction-presentation.js'

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

test('strips all DSH host synthetic notices, snapshots, tool-registry, and runtime-context sections', () => {
  const realUser = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '推开门走进酒馆' }] }
  const tavernFrame = { role: 'user', source: { kind: 'plugin:dsh-tavern', form: 'foreground-frame' }, content: [{ type: 'text', text: '<lorebook_activated>…</lorebook_activated>' }] }
  const reply = { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '木门吱呀一声开了。' }] }
  const systemPrompt = {
    role: 'system',
    source: {
      kind: 'system-prompt',
      sections: [
        { name: 'deployment:persona-prefix', text: 'host persona' },
        { name: 'harness:source', text: 'checkout prompt' },
        { name: 'app:web-surface', text: 'web gui prompt' },
        { name: 'tavern:story', text: '酒馆系统提示词' },
      ],
    },
    content: [{ type: 'text', text: 'raw' }],
  }
  const hostRuntimeContext = {
    role: 'user',
    source: {
      kind: 'runtime-context',
      form: 'snapshot',
      sections: [
        { name: 'working-directory:current', text: 'Current working directory: "/tmp"' },
        { name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' },
        { name: 'approval:policy', text: 'Approval prompts are disabled.' },
        { name: 'plan:policy', text: 'Plan mode.' },
        { name: 'tool:subagent:depth', text: 'Delegation depth: 0' },
        { name: 'tool:subagent_fork:depth', text: 'Delegation depth: 0' },
        { name: 'subagent:delegation', text: 'subagent' },
        { name: 'harness:source', text: 'checkout' },
        { name: 'app:web-surface', text: 'http://127.0.0.1:1234' },
        { name: 'team:identity', text: 'Team Lead' },
        { name: 'team:policy', text: 'team policy' },
        { name: 'tool:jobs', text: 'jobs' },
        { name: 'cordis-dynamic', text: 'cordis' },
      ],
    },
    content: [{ type: 'text', text: 'Current runtime context...' }],
  }
  const emptyRuntimeContext = {
    role: 'user',
    source: { kind: 'runtime-context', form: 'snapshot' },
    content: [{ type: 'text', text: 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.' }],
  }
  const hostUserKinds = [
    'agent-instructions',
    'user-approval',
    'model-selection',
    'time-context',
    'working-directory',
    'plan-mode',
    'repeat-tool-reminder',
    'skill-catalog',
    'tmux-context',
    'cordis-host-runner',
    'tool-jobs',
    'action-cards',
    'subagent-settled',
  ]
  const hostNotices = [
    ...hostUserKinds.map(kind => message({ kind, form: 'notice' }, `noise:${kind}`)),
    message({ kind: 'plugin:model-selection' }, 'legacy-prefix'),
    message({ kind: 'plugin', plugin: '@deepseek-ai/dsh-time-context' }, 'legacy-object'),
    { role: 'developer', source: { kind: 'tool-registry' }, content: [{ type: 'tool-addition', toolName: 'bash' }] },
  ]

  const result = presentWorkspaceInstructions({
    sessionId: 's',
    messages: [systemPrompt, hostRuntimeContext, emptyRuntimeContext, ...hostNotices, realUser, tavernFrame, reply],
  })

  assert.equal(result.messages.length, 4)
  assert.equal(result.messages[0].role, 'system')
  assert.deepEqual(result.messages[0].source.sections.map(s => s.name), ['tavern:story'])
  assert.equal(result.messages[0].content[0].text, '酒馆系统提示词')
  assert.deepEqual(result.messages.slice(1), [realUser, tavernFrame, reply])
})

test('returns the original request object when nothing needs filtering', () => {
  const req = {
    sessionId: 's',
    messages: [
      { role: 'system', source: { kind: 'system-prompt', sections: [{ name: 'tavern:story', text: 'ok' }] }, content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
    ],
  }
  assert.equal(presentWorkspaceInstructions(req), req)
})
