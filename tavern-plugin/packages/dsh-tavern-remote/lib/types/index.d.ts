import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { TavernSessionSignalFrame, TavernSessionSignalSource } from './shared.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        tavernSessionSignals: TavernSessionSignalSource;
        tavernSignalRemote: TavernSessionSignalRemote;
    }
}
export declare class TavernSessionSignalRemote extends TypertRemoteService {
    static inject: string[];
    constructor(ctx: Context);
    follow(sessionIds: readonly string[], signal: AbortSignal): AsyncIterable<TavernSessionSignalFrame>;
}
export { type TavernSessionSignal, type TavernSessionSignalFrame } from './shared.js';
export default TavernSessionSignalRemote;
//# sourceMappingURL=index.d.ts.map