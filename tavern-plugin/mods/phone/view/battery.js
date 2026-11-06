// the phone status bar glyphs, one implementation for the stage phone (view/index.html loads
// this file before index.js) and the settings preview (the client bundle includes it, mod-config-pages.js).
// Battery: above 40% the normal ink, at or below 40% yellow, at or below 20% red. No per-card setting.
var PHONE_BATTERY = Object.freeze({ warn: 40, low: 20 });
function phoneModBatteryLevel(percent) { return percent <= PHONE_BATTERY.low ? 'low' : percent <= PHONE_BATTERY.warn ? 'warn' : 'ok'; }
// The iOS 17 status bar's right cluster (UI-kit proportions: cellular 17x10.67, Wi-Fi 15.3x11, battery 27.3x13) redrawn on
// whole CSS pixels, so it is crisp at 1x and 2x when the view is not zoomed:
// signal 18x10 — four 3-wide bars 4/6/8/10 tall; Wi-Fi 15x11 — a wedge and two 2.2-thick bands at ±45°, corners rounded
// by a 0.7 stroke; battery 28x13 — a 1px outline body at 40% ink with the nub attached in the same ink, the fill inset
// 2px in proportion to the level, and the percentage centred: knocked out of the fill (the wallpaper shows through),
// ink over the empty part, black over a yellow / red fill.
// All three share one 14-tall box (battery body rows 0–13 of it, glyphs centred on it), so they land on whole pixels.
// Markup strings, so the view (innerHTML) and the preview (dangerouslySetInnerHTML) paint the same SVG.
function phoneModSignalSvg(bars) {
    return '<svg class="signal" viewBox="0 -1 18 14" width="18" height="14" fill="currentColor" aria-hidden="true">'
        + [4, 6, 8, 10].map((h, i) => '<rect x="' + i * 5 + '" y="' + (12 - h) + '" width="3" height="' + h + '" rx="1"' + (i < bars ? ' class="on"' : ' opacity=".3"') + '/>').join('') + '</svg>';
}
function phoneModWifiSvg() {
    return '<svg class="wifi" viewBox="0 -2 15 14" width="15" height="14" fill="currentColor" stroke="currentColor" stroke-width=".7" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M7.5 10.41L5.61 8.51A3.05 3.05 0 0 1 9.39 8.51ZM3.05 5.96A6.65 6.65 0 0 1 11.95 5.96L10.89 7.02A5.15 5.15 0 0 0 4.11 7.02ZM.5 3.41A10.25 10.25 0 0 1 14.5 3.41L13.43 4.47A8.75 8.75 0 0 0 1.57 4.47Z"/></svg>';
}
function phoneModBatterySvg(percent, id) {
    const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0))), level = phoneModBatteryLevel(p);
    const w = Math.round(22 * p) / 100, fill = level === 'ok' ? 'currentColor' : level === 'warn' ? '#ffd60a' : '#ff453a';
    const text = attrs => '<text ' + attrs + ' x="13" y="9.6" text-anchor="middle">' + p + '</text>';
    return '<svg class="battery" viewBox="0 -1 28 14" width="28" height="14" data-level="' + level + '" aria-hidden="true">'
        + '<defs><mask id="' + id + '-k" maskUnits="userSpaceOnUse" x="0" y="-1" width="28" height="14"><rect y="-1" width="28" height="14" fill="#fff"/>' + text('fill="#000"') + '</mask>'
        + '<clipPath id="' + id + '-e"><rect x="' + (2 + w) + '" y="-1" width="28" height="14"/></clipPath><clipPath id="' + id + '-f"><rect x="2" y="2" width="' + w + '" height="9" rx="2.5"/></clipPath></defs>'
        + '<rect x=".5" y=".5" width="25" height="12" rx="4" fill="none" stroke="currentColor" stroke-opacity=".4"/>'
        + '<path d="M26 4h.25c.83 0 1.5.67 1.5 1.5v2c0 .83-.67 1.5-1.5 1.5H26z" fill="currentColor" fill-opacity=".4"/>'
        + '<rect x="2" y="2" width="' + w + '" height="9" rx="2.5" fill="' + fill + '" mask="url(#' + id + '-k)"/>'
        + text('class="pct" fill="currentColor" clip-path="url(#' + id + '-e)"')
        + (level === 'ok' ? '' : text('fill="#000" clip-path="url(#' + id + '-f)"')) + '</svg>';
}
