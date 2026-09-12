/** Count enabled-state transitions without retaining resource content or identifiers. */
export function resourceSaveSummary(target, scope, before, after, native = false) {
  const rows = value => Array.isArray(value) ? value : Object.values(value || {})
  const key = row => row.uid ?? row.id ?? row.name
  const enabled = row => native ? row.disabled !== true && row.disable !== true : row.enabled !== false
  const prior = new Map(rows(before).map(row => [key(row), enabled(row)]))
  let enabledCount = 0, disabledCount = 0
  for (const row of rows(after)) {
    const next = enabled(row)
    if (prior.get(key(row)) === next) continue
    if (next) enabledCount++; else disabledCount++
  }
  return enabledCount || disabledCount ? { target, scope, enabledCount, disabledCount } : null
}

export async function observeResourceSave(summary, save, record) {
  try {
    const result = await save()
    if (summary) { try { await record?.({ ...summary, status: 'success' }) } catch {} }
    return result
  } catch (error) {
    if (summary) { try { await record?.({ ...summary, status: 'failed' }) } catch {} }
    throw error
  }
}
