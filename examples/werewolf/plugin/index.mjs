import { gameMode } from './rules.mjs'
export const name = 'dsh-card-werewolf'
export const inject = ['tavern']
export function apply(ctx) {
  if (ctx.tavern.capabilities?.gameMode !== 1) throw new Error('六人狼人杀需要支持 gameMode 的新版 DSH Tavern')
  for (const [index, title] of ['1号', '林岚', '顾舟', '苏晚', '陈默', '叶青'].entries()) {
    ctx.tavern.member({ name: 'npc-' + (index + 1), title: (index + 1) + '号 · ' + title })
  }
  ctx.tavern.gameMode(gameMode)
}
