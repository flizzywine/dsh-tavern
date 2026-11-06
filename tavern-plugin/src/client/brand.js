// The tavern shell owns the tab while it is mounted. Brand images reach the
// stylesheet through custom properties so tavern.css stays a verbatim asset.
// They live in a stylesheet rule, not the root element's inline style: the host
// rewrites that style on layout changes, re-parsing every inline property.
// The icon link is appended last so it wins over the host icon; disposal
// restores the host icon.
function installTavernBrand(doc, urls) {
  const properties = { '--dsh-tavern-logo': urls.logo, '--dsh-tavern-lockup': urls.lockup, '--dsh-tavern-lockup-dark': urls['lockup-dark'] };
  const style = doc.createElement('style');
  style.dataset.plugin = 'dsh-tavern-plugin';
  style.textContent = ':root{' + Object.entries(properties).map(([name, url]) => name + ':url("' + String(url).replace(/["\\\n]/g, encodeURIComponent) + '")').join(';') + '}';
  doc.head.appendChild(style);
  const link = doc.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = urls.logo;
  link.dataset.plugin = 'dsh-tavern-plugin';
  doc.head.appendChild(link);
  // The host hardcodes its product name into document.title ("<session> — DeepSeek Harness").
  const hostTitle = 'DeepSeek Harness';
  function retitle() { if (doc.title.includes(hostTitle)) doc.title = doc.title.replace(hostTitle, 'DSH Tavern'); }
  const Observer = doc.defaultView && doc.defaultView.MutationObserver;
  const observer = Observer ? new Observer(retitle) : null;
  if (observer) observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
  retitle();
  return function () {
    if (observer) observer.disconnect();
    link.remove();
    style.remove();
  };
}
