// 依赖无关的世界书常驻排布重排与预算核算逻辑。
// 服务端测试与客户端排布页通过 @include-domain 共享同一套实现，避免双份分叉。

function comparePlacementKey(left, right) {
  return String(left ?? '0').localeCompare(String(right ?? '0'), 'en', { numeric: true })
}

function parsePlacementTarget(key) {
  const text = String(key ?? '0')
  if (text.startsWith('4:')) {
    const parts = text.split(':')
    return {
      position: 4,
      depth: Number.isFinite(Number(parts[1])) ? Math.trunc(Number(parts[1])) : 4,
      role: Number.isFinite(Number(parts[2])) ? Math.trunc(Number(parts[2])) : 0
    }
  }
  const num = Number(text)
  return { position: Number.isFinite(num) ? Math.trunc(num) : 0 }
}

/**
 * 按与 `activateWorldBook` 一致的规则核算每轮尾部常驻条目的预算占用：
 * - `order` 越大越先入选，同 `order` 按 `displayIndex` 从小到大（与 `priorityOrder` 一致）
 * - 只有 `chargesBudget` 为真的条目（`channel === 'tail'` 或非常驻 `auto`）才计入软预算
 * - 单条成本为 `tokens + 2`，超过软上限或硬上限（2×软上限）即停止后续计费条目入选
 */
function computeWorldBookTailBudget(tailItems, tokenBudget = 8192) {
  const limit = Number.isFinite(Number(tokenBudget)) && Number(tokenBudget) >= 0 ? Math.trunc(Number(tokenBudget)) : 8192
  const hardLimit = limit * 2
  const list = Array.isArray(tailItems) ? tailItems : []
  const prioritized = list.map((item, index) => ({ item, index })).sort((a, b) =>
    (Number(b.item.order ?? 100) - Number(a.item.order ?? 100)) ||
    (Number(a.item.displayIndex ?? a.index) - Number(b.item.displayIndex ?? b.index)) ||
    (a.index - b.index)
  ).map(entry => entry.item)

  let used = 0
  let overflowed = false
  const evictedIds = new Set()

  for (const item of prioritized) {
    const charges = item.chargesBudget === true
    const cost = charges ? (Number(item.budgetCost) || (Number(item.tokens) || 0) + 2) : 0
    if (charges && (overflowed || used >= limit || used + cost > hardLimit)) {
      overflowed = true
      evictedIds.add(item.id)
      continue
    }
    if (charges) used += cost
  }

  return { limit, hardLimit, used, overflowed, evictedIds }
}

/**
 * 计算将某条常驻条目移动到目标通道与顺位后所需的最小写回操作（按原书分组），
 * 保证写回后服务端再次 `promptOrder` 得到的顺序与用户拖放后的视觉顺序完全一致。
 */
function planWorldBookLayoutReorder({ prefix = [], tail = [], movedId, targetZone, targetIndex, tokenBudget = 8192 }) {
  const allBefore = new Map()
  for (const item of prefix) allBefore.set(item.id, item)
  for (const item of tail) allBefore.set(item.id, item)

  const original = allBefore.get(movedId)
  if (!original) return { ok: false, reason: 'not-found' }
  if (targetZone !== 'prefix' && targetZone !== 'tail') return { ok: false, reason: 'invalid-zone' }
  if (targetZone === 'prefix' && original.lockedToTail === true) {
    return { ok: false, reason: 'dynamic-locked', entry: original }
  }

  const oldZone = original.zone
  const oldList = oldZone === 'prefix' ? prefix : tail
  const oldIndex = oldList.findIndex(item => item.id === movedId)

  const nextPrefix = prefix.filter(item => item.id !== movedId).map(item => Object.assign({}, item))
  const nextTail = tail.filter(item => item.id !== movedId).map(item => Object.assign({}, item))
  const destList = targetZone === 'prefix' ? nextPrefix : nextTail
  const clampedIndex = Math.max(0, Math.min(Number.isFinite(targetIndex) ? Math.trunc(targetIndex) : destList.length, destList.length))

  if (oldZone === targetZone && oldIndex === clampedIndex) {
    return { ok: true, changed: false, prefix, tail, updates: [], changes: [], affectedGlobalBooks: [], prefixChanged: false }
  }

  const moved = Object.assign({}, original, { zone: targetZone })
  const channelChanged = oldZone !== targetZone
  if (channelChanged) {
    moved.channel = targetZone
    moved.channelInherited = false
    moved.chargesBudget = targetZone === 'tail'
    moved.budgetCost = moved.chargesBudget ? (Number(moved.tokens) || 0) + 2 : 0
    moved.forcedChannel = !moved.constant
  }

  destList.splice(clampedIndex, 0, moved)

  // 若跨过了不同的注入位置分桶（placementKey），对齐到落点相邻条目的位置分桶，
  // 否则 promptOrder 仍会按原 placementKey 把条目拉回原段。
  const prev = destList[clampedIndex - 1]
  const next = destList[clampedIndex + 1]
  const needAdoptPrev = prev && comparePlacementKey(prev.placementKey, moved.placementKey) > 0
  const needAdoptNext = !needAdoptPrev && next && comparePlacementKey(moved.placementKey, next.placementKey) > 0
  let positionPatched = null
  if (needAdoptPrev || needAdoptNext) {
    const donor = needAdoptPrev ? prev : next
    const parsed = parsePlacementTarget(donor.placementKey)
    moved.placementKey = donor.placementKey
    moved.position = parsed.position
    positionPatched = { position: parsed.position }
    if (parsed.position === 4) {
      moved.depth = parsed.depth
      moved.role = parsed.role
      positionPatched.depth = parsed.depth
      positionPatched.role = parsed.role
    }
  }

  // 在目标 placementKey 分桶内维护严格递增的 order，避免同 order 退回 displayIndex 倒排。
  const bucket = destList.filter(item => item.placementKey === moved.placementKey)
  const bIdx = bucket.findIndex(item => item.id === moved.id)
  const bPrev = bucket[bIdx - 1]
  const bNext = bucket[bIdx + 1]

  if (bPrev && bNext && (Number(bNext.order) - Number(bPrev.order) >= 2)) {
    moved.order = Math.floor((Number(bPrev.order) + Number(bNext.order)) / 2)
  } else if (!bPrev && bNext && Number(bNext.order) >= 1) {
    moved.order = Math.max(0, Number(bNext.order) - 10)
  } else if (bPrev && !bNext) {
    moved.order = Number(bPrev.order) + 10
  } else if (!bPrev && !bNext) {
    // 分桶内仅此一条，保持原 order。
  } else {
    // 落点前后没有整数空隙（例如整排默认 100），按当前显示顺位统一重编为 10、20、30…
    bucket.forEach((item, index) => {
      item.order = (index + 1) * 10
    })
  }

  // 重新核算尾部预算状态。
  const budget = computeWorldBookTailBudget(nextTail, tokenBudget)
  for (const item of nextPrefix) item.budgetEvicted = false
  for (const item of nextTail) item.budgetEvicted = budget.evictedIds.has(item.id)

  // 按原书汇总最小写回操作。
  const byBook = new Map()
  const changes = []
  const affectedGlobalSet = new Set()

  for (const item of nextPrefix.concat(nextTail)) {
    const before = allBefore.get(item.id)
    if (!before) continue
    const patch = {}
    if (Number(item.order) !== Number(before.order)) patch.order = Number(item.order)
    if (item.id === moved.id && channelChanged) patch.channel = targetZone
    if (item.id === moved.id && positionPatched) Object.assign(patch, positionPatched)
    if (!Object.keys(patch).length) continue

    const bookKey = JSON.stringify(item.bookSource)
    if (!byBook.has(bookKey)) {
      byBook.set(bookKey, {
        source: item.bookSource,
        bookName: item.bookName,
        bookIsGlobal: item.bookIsGlobal === true,
        operations: []
      })
    }
    byBook.get(bookKey).operations.push({ op: 'update', ref: item.entryRef, patch })
    if (item.bookIsGlobal === true) affectedGlobalSet.add(item.bookName)
    changes.push({
      id: item.id,
      title: item.title,
      bookName: item.bookName,
      bookIsGlobal: item.bookIsGlobal === true,
      prevOrder: Number(before.order),
      nextOrder: Number(item.order),
      channelChanged: item.id === moved.id && channelChanged,
      prevZone: before.zone,
      nextZone: item.zone,
      positionChanged: item.id === moved.id && Boolean(positionPatched)
    })
  }

  return {
    ok: true,
    changed: changes.length > 0,
    prefix: nextPrefix,
    tail: nextTail,
    updates: [...byBook.values()],
    changes,
    affectedGlobalBooks: [...affectedGlobalSet],
    prefixChanged: oldZone === 'prefix' || targetZone === 'prefix',
    channelChanged,
    oldZone,
    oldIndex,
    newIndex: clampedIndex,
    budget: {
      limit: budget.limit,
      hardLimit: budget.hardLimit,
      used: budget.used,
      overflowed: budget.overflowed
    }
  }
}

export { planWorldBookLayoutReorder, computeWorldBookTailBudget }
