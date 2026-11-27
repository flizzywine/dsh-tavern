// A viewport-sized card cannot determine its own iframe viewport. Use the host
// viewport as a floor for page layouts, while retaining authored local scrollers.
function tavernFrameViewportFloor() {
	var viewport = 600;
	try { viewport = window.parent.innerHeight || viewport; } catch (_) {}
	viewport = Math.max(160, Math.min(1200, viewport));
	var root = document.documentElement, body = document.body;
	if (root.hasAttribute('data-dsh-tavern-viewport-roots')) return viewport;
	function viewportHeight(style) {
		return /(?:^|[^\d.])100(?:d|s|l)?vh\b/i.test((style.height || '') + ' ' + (style.minHeight || ''));
	}
	function explicitViewportHeight(style) {
		return /^100(?:d|s|l)?vh$/i.test(style.height || '');
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
		var style = getComputedStyle(node);
		// Decorative fixed layers fill the frame they are given. They do not
		// request a taller frame than the menu or other in-flow content needs.
		if (style.position === 'fixed' && style.pointerEvents === 'none' && node.closest('[aria-hidden="true"]')) return false;
		var rect = node.getBoundingClientRect();
		return rect.width > window.innerWidth / 2 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
	}
	function matchesRules(rules, rootsOnly) {
		for (var rule of Array.from(rules || [])) {
			if (rule.media && !matchMedia(rule.media.mediaText).matches) continue;
			if (rule.selectorText && rule.style && (rootsOnly ? explicitViewportHeight(rule.style) : viewportHeight(rule.style))) {
				try {
					if (rootsOnly ? root.matches(rule.selectorText) || body.matches(rule.selectorText)
						: Array.from(document.querySelectorAll(rule.selectorText)).some(visible)) return true;
				} catch (_) {}
			}
			if (rule.cssRules && matchesRules(rule.cssRules, rootsOnly)) return true;
		}
		return false;
	}
	function viewportStyleSheet(rootsOnly) {
		for (var sheet of Array.from(document.styleSheets)) {
			try { if (!sheet.disabled && (!sheet.media.mediaText || matchMedia(sheet.media.mediaText).matches) && matchesRules(sheet.cssRules, rootsOnly)) return true; } catch (_) {}
		}
		return false;
	}
	// An absolutely centered screen takes its position from a viewport-sized
	// root. Resetting that root to content height sends the controls above the
	// clipped frame. A root with only min-height can still shrink with content.
	var centeredScreen = Array.from(body.children).some(function (node) {
		var style = getComputedStyle(node);
		return style.position === 'absolute' && style.transform !== 'none' && visible(node);
	});
	if (centeredScreen && (explicitViewportHeight(root.style) || explicitViewportHeight(body.style) || viewportStyleSheet(true))) {
		root.setAttribute('data-dsh-tavern-viewport-roots', '');
		return viewport;
	}
	if (viewportStyleSheet(false)) return viewport;
	for (var node of document.body.querySelectorAll('*')) {
		// Check the cheap conditions first; visible() measures layout.
		var style = getComputedStyle(node);
		// Full-page fixed shells have no normal-flow height at all. Floating
		// buttons or small dialogs must not enlarge the frame.
		if (!viewportHeight(node.style) && !(style.position === 'fixed' && style.top === '0px' && style.bottom === '0px')) continue;
		if (visible(node)) return viewport;
	}
	return 0;
}
