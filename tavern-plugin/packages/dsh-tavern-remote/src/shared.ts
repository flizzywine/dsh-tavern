export type TavernJsonValue = null | boolean | number | string | TavernJsonValue[] | { [key: string]: TavernJsonValue }

export interface TavernSessionSignal {
  readonly id: string
  readonly sessionId: string
  readonly kind: string
  readonly version: string
  readonly snapshot?: TavernJsonValue
}

export type TavernSessionSignalFrame =
  | { readonly type: 'snapshot', readonly signals: readonly TavernSessionSignal[] }
  | { readonly type: 'delta', readonly signal: TavernSessionSignal }

export interface TavernSessionSignalSource {
  follow(sessionIds: readonly string[], signal: AbortSignal): AsyncIterable<TavernSessionSignalFrame>
}

export interface TavernSessionSignalClient {
  subscribe(sessionId: string, kind: string, listener: (signal: TavernSessionSignal) => void,
    onError?: (error: unknown) => void, onConnect?: () => void): () => void
}
