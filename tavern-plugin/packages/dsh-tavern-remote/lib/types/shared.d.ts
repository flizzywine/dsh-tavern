export type TavernJsonValue = null | boolean | number | string | TavernJsonValue[] | {
    [key: string]: TavernJsonValue;
};
export type TavernRuntimeControlMethod = 'claimTavernScriptWork' | 'startTavernScriptWork' | 'getTavernScriptWorkState' | 'heartbeatTavernScriptRuntime' | 'completeTavernHelperEvent' | 'releaseTavernHelperRuntime';
export interface TavernSessionSignal {
    readonly id: string;
    readonly sessionId: string;
    readonly kind: string;
    readonly version: string;
    readonly snapshot?: TavernJsonValue;
}
export type TavernSessionSignalFrame = {
    readonly type: 'snapshot';
    readonly signals: readonly TavernSessionSignal[];
} | {
    readonly type: 'delta';
    readonly signal: TavernSessionSignal;
};
export interface TavernSessionSignalSource {
    follow(sessionIds: readonly string[], signal: AbortSignal): AsyncIterable<TavernSessionSignalFrame>;
    control(method: TavernRuntimeControlMethod, args: Record<string, TavernJsonValue>, signal: AbortSignal): Promise<string>;
}
export interface TavernSessionSignalClient {
    control(method: TavernRuntimeControlMethod, args: Record<string, TavernJsonValue>, signal?: AbortSignal): Promise<TavernJsonValue>;
    subscribe(sessionId: string, kind: string, listener: (signal: TavernSessionSignal) => void, onError?: (error: unknown) => void, onConnect?: () => void): () => void;
}
//# sourceMappingURL=shared.d.ts.map