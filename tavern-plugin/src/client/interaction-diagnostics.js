// Small, content-free ring buffer. Deliberately never persisted or uploaded.
function createInteractionDiagnostics(win) {
  const doc = win.document;
  const records = [];
  const limit = 120, lifetime = 10 * 60 * 1000;
  let lastClick = -Infinity, lastError = -Infinity, lastStall = -Infinity;
  function kind(element) {
    if (!element) return "none";
    if (element.closest?.('[data-composer-input="true"]')) return "composer";
    const tag = String(element.tagName || "").toLowerCase();
    return ["input", "textarea", "button", "iframe", "dialog", "body", "html"].includes(tag) ? tag : "other";
  }
  function trim() {
    const cutoff = Date.now() - lifetime;
    while (records.length && (records.length > limit || records[0].at < cutoff)) records.shift();
  }
  function record(type, detail) {
    records.push(Object.assign({ at: Date.now(), type, visible: doc.visibilityState === "visible", focused: doc.hasFocus(), active: kind(doc.activeElement) }, detail));
    trim();
  }
  function snapshot() { trim(); return { version: 1, retainedMinutes: 10, maxRecords: limit, events: records.map(item => ({ ...item })) }; }
  function start() {
    const removers = [], timers = new Set();
    function on(target, name, handler) { target.addEventListener(name, handler, true); removers.push(() => target.removeEventListener(name, handler, true)); }
    on(win, "focus", event => { if (event.target === win) record("window-focus"); });
    on(win, "blur", event => { if (event.target === win) record("window-blur"); });
    on(doc, "visibilitychange", () => record("visibility"));
    on(doc, "pointerdown", event => {
      const editor = doc.querySelector('[data-composer-input="true"]');
      // A composer under the stage cover (gal-entry.js) cannot be hit; reading its box would
      // force layout of the whole skipped transcript on every stage click.
      if (!editor || editor.closest('[data-fork-gal-covered]')) return;
      const rect = editor.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      if (Date.now() - lastClick < 300) return;
      lastClick = Date.now();
      const hit = doc.elementFromPoint(event.clientX, event.clientY);
      record("composer-click", { target: kind(hit), blocked: Boolean(hit && hit !== editor && !editor.contains(hit)), editable: editor.isContentEditable, inert: Boolean(editor.closest('[inert]')), modal: Boolean(doc.querySelector('dialog[open]')), pointerEvents: win.getComputedStyle(editor).pointerEvents === "none" ? "none" : "auto" });
      const timer = win.setTimeout(() => { timers.delete(timer); record("after-click", { composerFocused: doc.activeElement === editor || editor.contains(doc.activeElement) }); }, 150);
      timers.add(timer);
    });
    function error(type) { if (Date.now() - lastError < 1000) return; lastError = Date.now(); record(type); }
    on(win, "error", () => error("page-error"));
    on(win, "unhandledrejection", () => error("unhandled-rejection"));
    let observer;
    try {
      if (win.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
        observer = new win.PerformanceObserver(list => {
          const duration = Math.max(0, ...list.getEntries().map(entry => entry.duration));
          if (duration < 250 || Date.now() - lastStall < 5000) return;
          lastStall = Date.now(); record("main-thread-stall", { durationMs: Math.round(duration) });
        });
        observer.observe({ type: "longtask" });
      }
    } catch (_) { /* Unsupported webviews still record focus and clicks. */ }
    record("started");
    return () => { removers.forEach(remove => remove()); timers.forEach(timer => win.clearTimeout(timer)); observer?.disconnect(); };
  }
  function download() {
    const url = win.URL.createObjectURL(new win.Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" }));
    const link = doc.createElement("a");
    link.href = url; link.download = "tavern-interaction-diagnostics.json";
    doc.body.appendChild(link); link.click(); link.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  }
  return { start, snapshot, download };
}
