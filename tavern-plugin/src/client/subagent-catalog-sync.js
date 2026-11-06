// The header counts session summaries; its popup reads the lazy catalog.
// Refresh an opened catalog when membership/activity changes in the summary feed.
function syncTavernSubagentCatalogs(sessions, signals) {
  if (!sessions || !sessions.list || typeof sessions.refreshSubagents !== 'function') return function () {};
  const signatures = new Map();
  let disposed = false;
  function reconcile() {
    const snapshot = sessions.list.getSnapshot();
    const groups = new Map();
    for (const row of Object.values(snapshot.byId || {})) {
      if (row.origin !== 'subagent' || !row.parentId) continue;
      if (!groups.has(row.parentId)) groups.set(row.parentId, []);
      groups.get(row.parentId).push(row.id + ':' + String(row.running === true));
    }
    for (const [parentId, catalog] of Object.entries(snapshot.subagentsByParent || {})) {
      if (!catalog || catalog.state !== 'ready') continue;
      const rows = groups.get(parentId) || [];
      const signature = rows.slice().sort().join('|');
      const previous = signatures.get(parentId);
      if (previous === signature) continue;
      signatures.set(parentId, signature);
      // A catalog that just became ready was fetched moments ago; refetching it
      // repeats a full session scan. Only refresh when it misses a known child.
      if (previous === undefined) {
        const listed = new Set((catalog.entries || []).map(function (entry) { return entry && entry.id; }));
        if (rows.every(function (row) { return listed.has(row.slice(0, row.lastIndexOf(':'))); })) continue;
      }
      Promise.resolve().then(function () {
        if (!disposed) return sessions.refreshSubagents(parentId);
      }).catch(function (error) { console.warn('[DSH Tavern] 子代理目录刷新失败', error); });
    }
  }
  // Tavern retires failed background workers. The host keeps a disposed subagent in the
  // session list as an idle row; reloading the list drops it, as a page reload would.
  let watched = null, unwatch = function () {}, refreshing = null, again = false;
  // The host reuses a list pull already in flight, which may predate this retirement: pull again after it.
  function refreshList() {
    if (disposed || typeof sessions.refresh !== 'function') return;
    if (refreshing) { again = true; return; }
    again = false;
    refreshing = Promise.resolve(sessions.refresh()).catch(function (error) { console.warn('[DSH Tavern] 会话列表刷新失败', error); })
      .finally(function () { refreshing = null; if (again) refreshList(); });
  }
  function follow() {
    // 0.2 hosts dropped the snapshot's top-level current; the main view's retain names it now.
    const snapshot = sessions.list.getSnapshot();
    const main = Object.values(snapshot.byId || {}).find(function (row) { return row && row.retainedBy && (row.retainedBy.mainView ?? 0) > 0; });
    const current = (main && main.id) || snapshot.current || null;
    if (current === watched || !signals || typeof signals.subscribe !== 'function') return;
    unwatch();
    watched = current;
    unwatch = current ? signals.subscribe(current, 'subagents', refreshList) : function () {};
  }
  const stop = sessions.list.subscribe(function () { reconcile(); follow(); });
  reconcile();
  follow();
  return function () { disposed = true; stop(); unwatch(); };
}
