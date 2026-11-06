// The native conversation root survives hero -> active transitions. Derive the
// landing marker at those boundaries, not with a descendant :has() on every
// message element whenever the composer changes.
function installTavernLandingStyles(doc) {
  const Observer = doc.defaultView && doc.defaultView.MutationObserver;
  if (!Observer || !doc.body) return function () {};
  const roots = new Map();
  // Current hosts mount the conversation at main.conversation; older ones used conversation.
  const slotSelector = '[data-slot="main.conversation"], [data-slot="conversation"]';
  function watch(root) {
    let presetRow = null;
    function sync() {
      const hero = root.getAttribute('data-phase') === 'hero';
      const nextRow = hero ? root.querySelector('[data-slot="conversation.hero.agentPreset"]')?.parentElement : null;
      if (presetRow !== nextRow) {
        if (presetRow) presetRow.classList.remove('dsh-tavern-hero-preset-row');
        presetRow = nextRow;
        if (presetRow) presetRow.classList.add('dsh-tavern-hero-preset-row');
      }
      const hasHeader = Array.from(root.children).some(child => child.getAttribute('data-slot') === 'conversation.session.header');
      const landing = hero && !hasHeader && Boolean(root.querySelector('[data-composer-seat]'));
      root.classList.toggle('dsh-tavern-landing', landing);
    }
    const observer = new Observer(records => {
      // Active-message streaming and input edits never rescan the history.
      if (root.getAttribute('data-phase') === 'hero' || records.some(record => record.target === root)) sync();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] });
    sync();
    return function () {
      observer.disconnect();
      root.classList.remove('dsh-tavern-landing');
      if (presetRow) presetRow.classList.remove('dsh-tavern-hero-preset-row');
    };
  }
  function discover() {
    for (const [root, release] of roots) if (!root.isConnected) { release(); roots.delete(root); }
    for (const slot of doc.querySelectorAll(slotSelector)) {
      for (const root of slot.children) {
        if (root.hasAttribute('data-phase') && !roots.has(root)) roots.set(root, watch(root));
      }
    }
  }
  const observer = new Observer(records => {
    if (Array.from(roots.keys()).some(root => !root.isConnected) || records.some(record =>
      !Array.from(roots.keys()).some(root => root.contains(record.target)) && Array.from(record.addedNodes).some(node =>
        node.nodeType === 1 && (node.matches(slotSelector) || node.querySelector(slotSelector) || node.parentElement?.matches(slotSelector))))) discover();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  discover();
  return function () {
    observer.disconnect();
    for (const release of roots.values()) release();
    roots.clear();
  };
}
