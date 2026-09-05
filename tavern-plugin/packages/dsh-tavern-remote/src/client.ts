import type { Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { TYPERT_REMOTE } from 'dsh-tavern-remote/remote'
import type { TavernSessionSignal, TavernSessionSignalClient, TavernSessionSignalFrame, TavernSessionSignalSource } from './shared.js'

type Listener = {
  sessionId: string
  kind: string
  listener: (signal: TavernSessionSignal) => void
  onError?: (error: unknown) => void
  onConnect?: () => void
}

type TavernSessionSignalSnapshot = Extract<TavernSessionSignalFrame, { type: 'snapshot' }>
type TavernSessionSignalDelta = Extract<TavernSessionSignalFrame, { type: 'delta' }>
type TavernSignalSnapshotStream = RemoteSnapshotStream<TavernSessionSignalSnapshot, TavernSessionSignalDelta>

declare module '@deepseek-ai/cordis' {
  interface Context { tavernSessionSignals: TavernSessionSignalClient }
}

export const inject = ['remote']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)
  const tavernSignals = ctx.get('remote.tavernSignals') as TavernSessionSignalSource | undefined
  if (tavernSignals === undefined) throw new Error('dsh-tavern-remote: remote.tavernSignals is unavailable after mount')
  const listeners = new Set<Listener>()
  const latest = new Map<string, TavernSessionSignal>()
  let connected = false
  let started = false
  let disposed = false
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let control: TavernSignalSnapshotStream | undefined
  const sessionIds = () => Array.from(new Set(Array.from(listeners, item => item.sessionId))).sort()
  const key = (sessionId: string, kind: string) => `${sessionId}\u0000${kind}`
  const report = (error: unknown) => { for (const item of listeners) item.onError?.(error) }
  const publish = (signal: TavernSessionSignal) => {
    latest.set(key(signal.sessionId, signal.kind), signal)
    for (const item of listeners) if (item.sessionId === signal.sessionId && item.kind === signal.kind) item.listener(signal)
  }
  const scheduleRecovery = (failed: TavernSignalSnapshotStream) => {
    if (disposed || retryTimer !== undefined || control !== failed) return
    connected = false
    const delay = Math.min(5000, 250 * (2 ** retryAttempt++))
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (disposed || control !== failed) return
      void failed.dispose().finally(() => {
        if (disposed || control !== failed) return
        control = undefined
        startStream()
      })
    }, delay)
  }
  const startStream = () => {
    if (disposed || control !== undefined || listeners.size === 0) return
    const stream = ctx.remote.$stream({
      name: 'Tavern session signal stream',
      open: (signal: AbortSignal) => tavernSignals.follow(sessionIds(), signal),
      ended: (accepted: boolean) => accepted
        ? new RemoteStreamCarrierError('Tavern session signal stream ended unexpectedly')
        : new Error('Tavern session signal stream ended before its snapshot'),
      carrierFailed: report,
    })
    const next = new RemoteSnapshotStream(stream, {
      name: 'Tavern session signal stream',
      isSnapshot: (frame: TavernSessionSignalFrame) => frame.type === 'snapshot',
      replace: (frame: TavernSessionSignalSnapshot) => {
        retryAttempt = 0
        latest.clear()
        for (const signal of frame.signals) latest.set(key(signal.sessionId, signal.kind), signal)
        connected = true
        for (const item of listeners) {
          item.onConnect?.()
          const signal = latest.get(key(item.sessionId, item.kind))
          if (signal !== undefined) item.listener(signal)
        }
      },
      update: (frame: TavernSessionSignalDelta) => { publish(frame.signal) },
      failed: (error: unknown) => { report(error); scheduleRecovery(next) },
    })
    control = next
    next.start()
  }
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
      if (!started) { started = true; startStream() }
      else if (control === undefined) startStream()
      else if (before !== after) control.restart()
      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        const previous = sessionIds().join('\u0000')
        listeners.delete(item)
        if (previous !== sessionIds().join('\u0000')) control?.restart()
      }
    },
  })
  ctx.provide('tavernSessionSignals', service)
  return async () => {
    disposed = true
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    await control?.dispose()
    await unmount()
  }
}
