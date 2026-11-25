import test from 'node:test'
import assert from 'node:assert/strict'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { settleUserText } from '../tavern-plugin/lib/domain/settlement-turn.js'
import { collectMvuHelperContext, createMvuBackgroundTaskFrame, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

for (const withoutGreeting of [true, false]) test(`opening setup reaches only the first settlement (withoutGreeting=${withoutGreeting})`, async () => {
  const h = initializationFixture()
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null } })
  const draft = await service.create(h.card.path)
  const note = 'The tournament is halfway over; the player already has 600000 followers.'
  await service.callRuntime(draft.id, 'prepareOpeningCommand', { openingId: 'primary', line: '/sys ' + note + (withoutGreeting ? ' | /cut 0' : '') + ' | /trigger' })
  const chat = await h.make().start({ ...h.input, preparation: service.resolve(draft.id, h.card.path, 'primary') })
  const initialVariables = { stat_data: { tickets: 3 }, schema: {} }
  const helperText = "The player has a reserved seat.\n\n<UpdateVariable>_.set('tickets', 3);</UpdateVariable>"
  const helper = { role: 'tavern-helper', text: helperText, variables: [initialVariables] }
  chat.messages.push(helper, { role: 'tavern-helper', text: '<initvar>{"unused":true}</initvar>' },
    { role: 'user', text: 'Continue.' }, { role: 'assistant', text: 'The crowd cheers.' })
  const request = () => projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({
    operationId: 'opening-settlement', chatId: chat.id, branchId: 'main', basedOnRevision: 1,
    messageId: chat.messages.length - 1, swipeId: 0, storyText: 'The crowd cheers.',
    currentVariables: initialVariables,
    helperContext: collectMvuHelperContext(chat.messages, chat.messages.length - 1)
  }))
  assert.ok(settleUserText(chat).includes(note))
  assert.ok(request().turnContext.includes(note))
  assert.match(request().turnContext, /reserved seat/)
  assert.match(request().turnContext, /"tickets":3/)
  assert.doesNotMatch(request().turnContext, /<UpdateVariable>|<initvar>|_\.set|unused/)
  assert.equal(helper.text, helperText)
  chat.messages.push({ role: 'user', text: 'Wave.' }, { role: 'assistant', text: 'You wave.' })
  assert.ok(!settleUserText(chat).includes(note))
  assert.ok(!request().turnContext.includes(note))
  assert.doesNotMatch(request().turnContext, /reserved seat/)
})
