// A viewport-sized card cannot determine its own iframe viewport. Use the host
// viewport as a floor for page layouts, while retaining authored local scrollers.
function tavernFrameViewportFloor() {
	var viewport = 600;
	try { viewport = window.parent.innerHeight || viewport; } catch (_) {}
	viewport = Math.max(160, Math.min(1200, viewport));
	function viewportHeight(style) {
		return /(?:^|[^\d.])100(?:d|s|l)?vh\b/i.test((style.height || '') + ' ' + (style.minHeight || ''));
	}
	function visible(node) {
        // The embedding adapter resets document roots to content height. An
        // overridden author rule on body/html is not a live viewport-sized panel.
        if (node === document.body || node === document.documentElement) return false;
        for (var ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
                var summary = ancestor.querySelector('summary');
                if (!summary || !summary.contains(node)) return false;
            }
        }
		var rect = node.getBoundingClientRect();
		var style = getComputedStyle(node);
		return rect.width > window.innerWidth / 2 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
	}
	function matchesRules(rules) {
		for (var rule of Array.from(rules || [])) {
			if (rule.media && !matchMedia(rule.media.mediaText).matches) continue;
			if (rule.selectorText && rule.style && viewportHeight(rule.style)) {
				try { if (Array.from(document.querySelectorAll(rule.selectorText)).some(visible)) return true; } catch (_) {}
			}
			if (rule.cssRules && matchesRules(rule.cssRules)) return true;
		}
		return false;
	}
	for (var sheet of Array.from(document.styleSheets)) {
		try { if (!sheet.disabled && (!sheet.media.mediaText || matchMedia(sheet.media.mediaText).matches) && matchesRules(sheet.cssRules)) return viewport; } catch (_) {}
	}
	for (var node of document.body.querySelectorAll('*')) {
		if (!visible(node)) continue;
		var style = getComputedStyle(node);
		if (viewportHeight(node.style)) return viewport;
		// Full-page fixed shells have no normal-flow height at all. Floating
		// buttons or small dialogs must not enlarge the frame.
		if (style.position === 'fixed' && style.top === '0px' && style.bottom === '0px') return viewport;
	}
	return 0;
}
