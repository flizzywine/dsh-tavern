import { gameMode } from './rules.mjs'
export const name = 'dsh-card-werewolf'
export const inject = ['tavern']
export function apply(ctx) {
  if (ctx.tavern.capabilities?.gameMode !== 1) throw new Error('六人狼人杀需要支持 gameMode 的新版 DSH Tavern')
  for (let index = 0; index < 6; index++) {
    ctx.tavern.member({ name: 'npc-' + (index + 1), title: (index + 1) + '号' })
  }
  ctx.tavern.gameMode(gameMode)
}
