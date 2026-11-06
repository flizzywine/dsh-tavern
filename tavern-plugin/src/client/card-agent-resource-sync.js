// The card Agent edits cards, world books and presets on the server, often with
// generic file tools, so no page action announced the write. When a card
// workbench turn (or one of its child agents) ends, tell resource panels their
// data may have changed; hidden panels only mark themselves stale.
function syncTavernCardAgentResources(sessions, options = {}) {
  if (!sessions || !sessions.list) return function () {};
  const modes = options.modes || function () { return tavernSessionModes.values; };
  const notify = options.notify || notifyTavernDataChanged;
  const running = new Map();
  function isCardWork(row, byId) {
    for (let current = row, depth = 0; current && depth < 8; depth += 1) {
      if (modes()[current.id] === 'card') return true;
      if (current.origin !== 'subagent' || !current.parentId) return false;
      current = byId[current.parentId] || { id: current.parentId };
    }
    return false;
  }
  function reconcile() {
    const byId = sessions.list.getSnapshot().byId || {};
    let ended = false;
    for (const row of Object.values(byId)) {
      const now = row.running === true;
      if (running.get(row.id) === true && !now && isCardWork(row, byId)) ended = true;
      running.set(row.id, now);
    }
    if (ended) notify(['worldbooks', 'cards', 'presets', 'scripts'], 'card-agent');
  }
  const stop = sessions.list.subscribe(reconcile);
  reconcile();
  return stop;
}
