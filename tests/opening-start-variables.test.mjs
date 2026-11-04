import test from 'node:test'
import assert from 'node:assert/strict'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { settleUserText } from '../tavern-plugin/lib/domain/settlement-turn.js'
import { collectMvuHelperContext, createMvuBackgroundTaskFrame, projectMvuBackgroundRequest, createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

for (const withoutGreeting of [true, false]) test(`opening setup reaches only the first settlement (withoutGreeting=${withoutGreeting})`, async () => {
  const h = initializationFixture()
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null } })
  const draft = await service.create(h.card.path)
  const note = 'The tournament is halfway over; the player already has 600000 followers.'
  await service.callRuntime(draft.id, 'prepareOpeningCommand', { openingId: 'primary', line: '/sys ' + note + (withoutGreeting ? ' | /cut 0' : '') + ' | /trigger' })
  const chat = await h.make().start({ ...h.input, preparation: service.resolve(draft.id, h.card.path, 'primary') })
  chat.messages.push({ role: 'user', text: 'Continue.' }, { role: 'assistant', text: 'The crowd cheers.' })
  const request = () => projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({
    operationId: 'opening-settlement', chatId: chat.id, branchId: 'main', basedOnRevision: 1,
    messageId: chat.messages.length - 1, swipeId: 0, storyText: 'The crowd cheers.',
    helperContext: collectMvuHelperContext(chat.messages, chat.messages.length - 1)
  }))
  assert.ok(settleUserText(chat).includes(note))
  assert.ok(request().turnContext.includes(note))
  chat.messages.push({ role: 'user', text: 'Wave.' }, { role: 'assistant', text: 'You wave.' })
  assert.ok(!settleUserText(chat).includes(note))
  assert.ok(!request().turnContext.includes(note))
})

test('setup evidence shown to the model also reaches runtime constraints, but not later rounds', async () => {
  const messages = [{ role: 'system', openingSetup: true, text: 'Mira (figure-42) starts with affinity 25.' },
    { role: 'user', text: 'Continue.' }, { role: 'assistant', text: 'Mira waves.' }]
  const before = { stat_data: { figures: { 'figure-42': { name: 'Mira', affinity: 5 } } }, schema: {} }
  const after = structuredClone(before)
  after.stat_data.figures['figure-42'].affinity = 25
  let runtimeInput
  const module = createMvuSettlementModule({
    model: { async run(request) {
      assert.ok(request.turnContext.includes(messages[0].text))
      const feedback = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: {
        operations: [{ op: 'replace', path: '/stat_data/figures/figure-42/affinity', value: 25 }]
      } }))
      assert.equal(feedback.ok, true, JSON.stringify(feedback))
      return {}
    } },
    runtime: { async settleMvuUpdate(input) {
      runtimeInput = input
      const variables = input.storyText.includes(messages[0].text) ? after : before
      return { variables, validation: input.validate({ before, after: variables }), rejected: variables === before, retryable: true }
    } }
  })
  const input = { operationId: 'setup-op', chatId: 'chat-17', sessionId: 'session-18', branchId: 'branch-3', basedOnRevision: 1,
    messageId: 2, swipeId: 0, storyText: messages[2].text, currentVariables: before, backgroundTasks: { posture: false },
    helperContext: collectMvuHelperContext(messages, 2) }
  const result = await module.settleVariables(input)
  assert.equal(result.receipt.status, 'updated')
  assert.ok(runtimeInput.storyText.includes(messages[0].text))
  await module.resumeVariables({ ...input, submission: result.submission })
  assert.ok(runtimeInput.storyText.includes(messages[0].text), 'durable replay uses the same evidence')
  messages.push({ role: 'user', text: 'Continue.' }, { role: 'assistant', text: 'Mira leaves.' })
  await module.resumeVariables({ ...input, messageId: 4, storyText: messages[4].text,
    helperContext: collectMvuHelperContext(messages, 4), submission: { operations: [] } })
  assert.equal(runtimeInput.storyText, messages[4].text)
})

test('removing the selected greeting preserves only its initvar for the normal runtime loader', async () => {
  const h = initializationFixture()
  h.card.first_mes = 'Unused scene<initvar>{"affinity":0}</initvar>'
  h.card.alternate_greetings = ['Selected scene<initvar>{"figures":{"figure-42":{"name":"Mira","affinity":5}}}</initvar>']
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null } })
  const draft = await service.create(h.card.path)
  await service.callRuntime(draft.id, 'prepareOpeningCommand', { openingId: 'alternate:0', line: '/sys Mira starts at affinity 25. | /cut 0 | /trigger' })
  const chat = await h.make().start({ ...h.input, openingId: 'alternate:0', preparation: service.resolve(draft.id, h.card.path, 'alternate:0') })
  assert.equal(chat.messages.length, 1)
  const floor = chat.messages[0]
  assert.equal(floor.text, 'Mira starts at affinity 25.')
  assert.equal(floor.sourceText, floor.text)
  assert.match(floor.swipes[0], /<initvar>.*"affinity":5.*<\/initvar>/)
  assert.doesNotMatch(floor.swipes[0], /Selected scene|Unused scene|"affinity":0/)
})
