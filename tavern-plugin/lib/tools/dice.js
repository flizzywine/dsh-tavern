import { rollDice } from '../domain/dice.js'

export const DICE_TOOL = {
  name: 'tavern_roll',
  description: "Roll 1d100; returns roll and tier. Only for real uncertainty that splits the story. hidden=true: only the GM sees the result; the player sees a covered die.",
  parameters: {
    check: { description: "Ability or skill tested, 2–4 characters, shown as <check>检定. E.g. 魔力, 观察, 说服, 潜行, 意志", type: 'string', required: true },
    attempt: { description: "What the character tries, in one sentence. E.g. climb in the bedroom window during the guard change", type: 'string', required: true },
    difficulty: { description: "easy 80 / normal 60 / hard 40 / extreme 20; set by the situation, normal if unsure", type: 'string', enum: ['easy', 'normal', 'hard', 'extreme'], required: true },
    reason: { description: "One sentence on why this difficulty. E.g. dense patrols, close range", type: 'string', required: true },
    hidden: { description: "true for what the character can't know (noticing, a lie, hidden danger); the player sees a covered die", type: 'boolean' },
    stakes: { description: "What success and failure each change. E.g. success: get the ledger; failure: alarm sounds", type: 'string', required: true }
  }
}

export function createDiceTool({ activeTurnOf, chatForSession, isBackground, authorizeMod = async () => true }) {
  return {
    ...DICE_TOOL,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ...Object.fromEntries(Object.entries(DICE_TOOL.parameters).map(([key, value]) => [key, { ...value, required: true }])),
        target: { type: 'integer', required: true },
        roll: { type: 'integer', required: true },
        tier: { type: 'string', enum: ['critical', 'success', 'costly', 'failure', 'fumble'], required: true }
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.id
      const turn = activeTurnOf(exec)
      if (!sessionId || !turn || isBackground(sessionId)) throw new Error('tavern_roll requires an active foreground story/script turn')
      const chat = await chatForSession(sessionId)
      if (!chat || !['story', 'script'].includes(chat.mode || 'story') || activeTurnOf(exec) !== turn || exec.signal?.aborted) {
        throw new Error('tavern_roll requires an active foreground story/script turn')
      }
      if (!await authorizeMod('dsh.dice',chat)) throw new Error('Dice mod is disabled for this card')
      return rollDice(args)
    }
  }
}
