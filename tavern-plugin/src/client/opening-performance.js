// Bounded timing metadata only; never retain action arguments or error messages.
function createOpeningPerformance() {
  const rows = [], requests = [];
  const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const id = () => typeof window !== 'undefined' && window.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
  function begin(stage, actionId) {
    const started = clock();
    const row = { id: actionId || id(), stage, startedAt: Date.now(), status: 'running' };
    rows.push({ row, started });
    if (rows.length > 120) rows.shift();
    return {
      finish(success) { if (row.status !== 'running') return; row.durationMs = Math.max(0, Math.round(clock() - started)); row.status = success ? 'completed' : 'failed'; },
      async measure(name, work) { const child = begin(name, row.id); try { const value = await work(); child.finish(true); return value; } catch (error) { child.finish(false); throw error; } }
    };
  }
  return { begin, recordRequest(row) { requests.push({ ...row }); if (requests.length > 60) requests.shift(); }, requests: () => requests.map(row => ({ ...row })), read: () => rows.map(({row, started}) => ({ ...row, durationMs: row.status === 'running' ? Math.max(0, Math.round(clock() - started)) : row.durationMs })) };
}
const openingPerformance = createOpeningPerformance();
