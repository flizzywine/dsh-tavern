// Runtime-only, bounded summaries. Never keep request arguments or response bodies.
export function createPerformanceDiagnostics() {
  const methods = new Map()
  const slow = []
  let browser = null
  let http = null
  const openings = []
  return {
    http(snapshot) { http = structuredClone(snapshot) },
    opening(value) {
      if (!value || !['resources', 'readCard', 'readExtensions', 'preview', 'prepare'].includes(value.stage)) return
      const row = { at: Date.now(), stage: value.stage }
      for (const key of ['durationMs', 'helperCount', 'regexCount', 'skippedCount', 'failedCount', 'cacheHitCount', 'sharedCount', 'cooldownCount']) {
        if (Number.isFinite(value[key]) && value[key] >= 0) row[key] = Math.min(1e12, Math.round(value[key]))
      }
      openings.push(row)
      if (openings.length > 60) openings.shift()
    },
    record(method, durationMs) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(method) || !Number.isFinite(durationMs)) return
      durationMs = Math.max(0, Math.round(durationMs))
      if (!methods.has(method) && methods.size >= 80) return
      const row = methods.get(method) || { count: 0, totalMs: 0, maxMs: 0, slowCount: 0 }
      row.count++; row.totalMs += durationMs; row.maxMs = Math.max(row.maxMs, durationMs)
      if (durationMs >= 1000) {
        row.slowCount++
        slow.push({ at: Date.now(), method, durationMs })
        if (slow.length > 30) slow.shift()
      }
      methods.set(method, row)
    },
    browser(value) {
      if (!value || typeof value !== 'object') return
      const clean = {}
      for (const key of ['observedMs', 'longTaskCount', 'longTaskTotalMs', 'longTaskMaxMs', 'slowRpcCount', 'slowRpcMaxMs']) {
        if (Number.isFinite(value[key]) && value[key] >= 0) clean[key] = Math.min(1e12, Math.round(value[key]))
      }
      for (const collection of ['requests', 'openingRequests']) if (Array.isArray(value[collection])) clean[collection] = value[collection].slice(-60).filter(row => row && /^[a-f0-9-]{36}$/.test(row.id || '') && ['getSession', 'syncSession', 'getCardOpenings', 'initializeOpeningTemplate', 'preparePlayStart', 'startChat'].includes(row.method)).map(row => {
        const result = { id: row.id, method: row.method, failed: row.failed === true }
        for (const key of ['sentAt', 'active', 'headersMs', 'parsedMs', 'durationMs', 'requestBytes', 'responseBytes', 'bodyChars']) {
          if (Number.isFinite(row[key]) && row[key] >= 0) result[key] = Math.min(key === 'sentAt' || key === 'startedAt' ? Number.MAX_SAFE_INTEGER : 1e12, Math.round(row[key]))
        }
        return result
      })
      if (Array.isArray(value.openings)) clean.openings = value.openings.slice(-120).filter(row => row && /^[a-f0-9-]{36}$/.test(row.id || '') && ['startClick', 'claimPrewarm', 'submitInitialMessage', 'preparePreview', 'startGame', 'archiveCurrent', 'resolveWorkspace', 'connectWorkspace', 'waitForSession', 'ensurePreset', 'createChat', 'finishOpen'].includes(row.stage) && ['running', 'completed', 'failed'].includes(row.status)).map(row => {
        const result = { id: row.id, stage: row.stage, status: row.status };
        for (const key of ['startedAt', 'durationMs']) if (Number.isFinite(row[key]) && row[key] >= 0) result[key] = Math.min(key === 'sentAt' || key === 'startedAt' ? Number.MAX_SAFE_INTEGER : 1e12, Math.round(row[key]));
        return result;
      })
      if (Object.keys(clean).length) browser = { ...clean, receivedAt: Date.now(), longTaskSupported: value.longTaskSupported === true }
    },
    read() {
      return { version: 1, scope: 'server-process-and-last-reporting-browser', resetsOnRestart: true,
        ...(http ? { http: structuredClone(http) } : {}),
        ...(openings.length ? { openings: openings.map(row => ({ ...row })) } : {}),
        slowThresholdMs: 1000, browserLongTaskThresholdMs: 100, browser: browser && structuredClone(browser),
        methods: [...methods].map(([method, row]) => ({ method, count: row.count, averageMs: Math.round(row.totalMs / row.count), maxMs: row.maxMs, slowCount: row.slowCount })),
        slow: slow.map(row => ({ ...row })) }
    }
  }
}
