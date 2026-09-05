import type { Context } from '@deepseek-ai/cordis';
import type { TavernSessionSignalClient } from './shared.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        tavernSessionSignals: TavernSessionSignalClient;
    }
}
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<() => Promise<void>>;
//# sourceMappingURL=client.d.ts.map