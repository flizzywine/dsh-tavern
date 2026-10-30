function installTavernStylesheet(doc, css, features) {
    const id = 'dsh-tavern-plugin/tavern.css';
    const selector = '[data-plugin-css="' + id + '"]';
    const active = doc.__dshTavernStylesheet;
    if (active) { active.dispose(); delete doc.__dshTavernStylesheet; }
    let style = doc.querySelector('style' + selector);
    if (!style) {
        style = doc.createElement('style');
        style.dataset.plugin = 'dsh-tavern-plugin';
        style.dataset.pluginCss = id;
        style.textContent = css;
        doc.head.appendChild(style);
    } else if (style.textContent !== css) style.textContent = css;
    let featureStyle = doc.querySelector('[data-plugin-css="dsh-tavern-plugin/features.css"]');
    if (!featureStyle) { featureStyle = doc.createElement("style"); featureStyle.dataset.pluginCss = "dsh-tavern-plugin/features.css"; doc.head.appendChild(featureStyle); }
    featureStyle.textContent = features;
    // Retire old link loaders only after the bundled styles are installed.
    for (const node of doc.querySelectorAll(selector)) if (node !== style) node.remove();
}
