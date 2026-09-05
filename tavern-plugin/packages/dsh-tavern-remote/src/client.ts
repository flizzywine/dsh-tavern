import type { Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { TYPERT_REMOTE } from 'dsh-tavern-remote/remote'
import type { TavernSessionSignal, TavernSessionSignalClient, TavernSessionSignalFrame } from './shared.js'

type Listener = {
  sessionId: string
  kind: string
  listener: (signal: TavernSessionSignal) => void
  onError?: (error: unknown) => void
  onConnect?: () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tavernSessionSignals: TavernSessionSignalClient }
}

export const inject = ['remote']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)
  const listeners = new Set<Listener>()
  const latest = new Map<string, TavernSessionSignal>()
  let connected = false
  let started = false
  const sessionIds = () => Array.from(new Set(Array.from(listeners, item => item.sessionId))).sort()
  const key = (sessionId: string, kind: string) => `${sessionId}\u0000${kind}`
  const report = (error: unknown) => { for (const item of listeners) item.onError?.(error) }
  const publish = (signal: TavernSessionSignal) => {
    latest.set(key(signal.sessionId, signal.kind), signal)
    for (const item of listeners) if (item.sessionId === signal.sessionId && item.kind === signal.kind) item.listener(signal)
  }
  const stream = ctx.remote.$stream({
    name: 'Tavern session signal stream',
    open: (signal: AbortSignal) => ctx.remote.tavernSignals.follow(sessionIds(), signal),
    ended: (accepted: boolean) => accepted
      ? new RemoteStreamCarrierError('Tavern session signal stream ended unexpectedly')
      : new Error('Tavern session signal stream ended before its snapshot'),
    carrierFailed: report,
  })
  const control = new RemoteSnapshotStream(stream, {
    name: 'Tavern session signal stream',
    isSnapshot: (frame: TavernSessionSignalFrame) => frame.type === 'snapshot',
    replace: (frame: Extract<TavernSessionSignalFrame, { type: 'snapshot' }>) => {
      latest.clear()
      for (const signal of frame.signals) latest.set(key(signal.sessionId, signal.kind), signal)
      connected = true
      for (const item of listeners) {
        item.onConnect?.()
        const signal = latest.get(key(item.sessionId, item.kind))
        if (signal !== undefined) item.listener(signal)
      }
    },
    update: (frame: Extract<TavernSessionSignalFrame, { type: 'delta' }>) => { publish(frame.signal) },
    failed: report,
  })
  const service: TavernSessionSignalClient = Object.freeze({
    subscribe(sessionId: string, kind: string, listener: (signal: TavernSessionSignal) => void,
      onError?: (error: unknown) => void, onConnect?: () => void) {
      const item: Listener = { sessionId: String(sessionId), kind: String(kind), listener, onError, onConnect }
      const before = sessionIds().join('\u0000')
      listeners.add(item)
      const after = sessionIds().join('\u0000')
      const signal = latest.get(key(item.sessionId, item.kind))
      if (connected) item.onConnect?.()
      if (signal !== undefined) item.listener(signal)
      if (!started) { started = true; control.start() }
      else if (before !== after) control.restart()
      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        const previous = sessionIds().join('\u0000')
        listeners.delete(item)
        if (previous !== sessionIds().join('\u0000')) control.restart()
      }
    },
  })
  ctx.provide('tavernSessionSignals', service)
  return async () => { await control.dispose(); await unmount() }
}
