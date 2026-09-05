import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TavernSessionSignalFrame, TavernSessionSignalSource } from './shared.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tavernSessionSignals: TavernSessionSignalSource
    tavernSignalRemote: TavernSessionSignalRemote
  }
}

export class TavernSessionSignalRemote extends TypertRemoteService {
  static inject = ['typert', 'tavernSessionSignals']

  constructor(ctx: Context) {
    super(ctx, 'tavernSignalRemote', { namespace: 'tavernSignals' })
  }

  @Remote({ mode: 'stream' })
  follow(sessionIds: readonly string[], signal: AbortSignal): AsyncIterable<TavernSessionSignalFrame> {
    return this.ctx.tavernSessionSignals.follow(sessionIds, signal)
  }
}

export { type TavernSessionSignal, type TavernSessionSignalFrame } from './shared.js'
export default TavernSessionSignalRemote
