// dsh-dream-skin — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-dream-skin/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table — the same shape the
// shipped ui-* packages' tsdown bundles emit. Only platform seed words and
// registered client bundles may be required.
//
// Persistence note: the skin choice and wallpaper settings are stored in
// localStorage. DSH's Host settings wire only exposes an allowlisted set of
// namespaces to browser clients (dsh-host-apiproxy's WEB_SETTINGS_NAMESPACES),
// so a third-party namespace would answer `settings-not-exposed`; the product
// itself keeps remote browser preferences process-local, and localStorage
// matches that boundary for visual preferences while surviving reloads on the
// same origin.

window.__ModuleLoader__.load({
	id: "dsh-dream-skin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// ── Platform seed resolution (defensive — blue-team R3/R4) ─────────────
		// The host does NOT isolate loader-entry factories: one throwing factory
		// aggregates into `entries did not activate` and takes the whole web
		// shell down ("Failed to load plugins" — the exact issue #43 blast
		// radius). So every platform seed is resolved inside a try. Seeds are
		// probed in candidate order and success is detected by the require
		// RETURNING — never by matching host-internal error wording (the old
		// `includes("missed the module table")` substring was an implementation
		// detail, not a contract — R4). On total failure the factory returns a
		// DUMB MODULE (no-op apply, empty surfaces): the plugin goes invisible
		// with one console warning instead of breaking DSH for every user. A
		// future seed rename can therefore never white-screen the host.
		const seedProbe = { lastError: null };
		const requireSeed = (name) => {
			try {
				return require(name);
			} catch (err) {
				seedProbe.lastError = err;
				return null;
			}
		};
		let react_jsx_runtime = requireSeed("react/jsx-runtime");
		let _react = requireSeed("react");
		// Settings-store factory host module (`defineStore`). One build must load
		// on both host generations: DSH master (post-0.1.2-alpha.1) split the old
		// `dsh-client-runtime` into `dsh-client-modules` / `dsh-client-store` /
		// `dsh-client-locale` and froze the platform module table to the new seed
		// names, while stable releases (≤ 0.1.1-rc.x) only provide
		// `@deepseek-ai/dsh-client-runtime/client` (issue #41 fixed master but
		// broke stable — issue #43). Master seed first, stable seed second.
		let _runtime_client = null;
		for (const seed of ["@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-runtime/client"]) {
			_runtime_client = requireSeed(seed);
			if (_runtime_client !== null) break;
		}
		if (react_jsx_runtime === null || _react === null || _runtime_client === null) {
			// A required platform seed is missing or broken on this host.
			// Degrade to "invisible but harmless": export a no-op surface so the
			// shell boots clean; keep the original error chain in the warning.
			const last = seedProbe.lastError;
			try {
				console.warn("[dsh-dream-skin] required host modules unavailable — plugin disabled for this session:", last && last.message);
			} catch {}
			exports.SETTINGS_NS = "settings.dreamSkin";
			exports.SKINS = [];
			exports.DEFAULT_SKIN = "system";
			exports.apply = () => {};
			exports.inject = [];
			return module.exports;
		}

		//#region dsh-dream-skin: constants & presets
		/** The settings row's locale namespace. */
		const SETTINGS_NS = "settings.dreamSkin";
		/** localStorage key holding the selected skin id. */
		const STORAGE_KEY = "dsh-dream-skin:skin";
		/** localStorage key holding the wallpaper image (data URL). */
		const WALLPAPER_KEY = "dsh-dream-skin:wallpaper";
		/** localStorage key holding the wallpaper wash opacity (0..1). */
		const WALLPAPER_OPACITY_KEY = "dsh-dream-skin:wallpaper-opacity";
		/** localStorage key holding the wallpaper blur radius (px). */
		const WALLPAPER_BLUR_KEY = "dsh-dream-skin:wallpaper-blur";
		/** localStorage key holding recent wallpaper history (JSON array of {kind,value}). */
		const WALLPAPER_HISTORY_KEY = "dsh-dream-skin:wallpaper-history";
		/** Max wallpaper history entries kept. */
		const WALLPAPER_HISTORY_MAX = 5;
		/** Sentinel meaning "no custom skin — follow the built-in appearance". */
		const DEFAULT_SKIN = "system";
		/** Default wash opacity (0..1) applied to the translucent surfaces. */
		const DEFAULT_WALLPAPER_OPACITY = 1;
		/** Default wallpaper blur radius in px. */
		const DEFAULT_WALLPAPER_BLUR = 0;
		/** localStorage key holding the sidebar wash opacity (0..1). */
		const SIDEBAR_OPACITY_KEY = "dsh-dream-skin:sidebar-opacity";
		/** localStorage key: link sidebar opacity to the main-canvas wash. */
		const SIDEBAR_LINK_KEY = "dsh-dream-skin:sidebar-link";
		/**
		 * ONE source of truth for the two sidebar preferences (issue #55 review).
		 * They have two readers with different jobs:
		 *   - `readSidebarOpacity()` / `readSidebarLink()` fall back to these
		 *     numbers when a key is ABSENT (the upgrade path: profiles that
		 *     predate the key, or lost it);
		 *   - `FACTORY_DEFAULTS` seeds the very same numbers on a true first
		 *     install.
		 * The two used to drift apart (reader: opacity 1, link ON; seed: "0.28",
		 * link OFF), so a profile that kept one key but not the other silently
		 * rendered differently depending on which reader answered. A single
		 * table cannot drift.
		 *
		 * All transparency controls default to 0% (fill opacity 1).
		 * Keep the sidebar link OFF so its slider remains independently usable.
		 */
		const SIDEBAR_DEFAULTS = { opacity: 1, link: false };
		/** Default sidebar wash opacity (0..1). */
		const DEFAULT_SIDEBAR_OPACITY = SIDEBAR_DEFAULTS.opacity;
		/** Default link flag (1 = follow the canvas wash, 0 = own slider). */
		const DEFAULT_SIDEBAR_LINK = SIDEBAR_DEFAULTS.link ? 1 : 0;
		/** localStorage key holding the popup / option-card fill opacity (0..1). */
		const MODAL_OPACITY_KEY = "dsh-dream-skin:modal-opacity";
		/** Default fill opacity for popups & the user-options card (kept readable). */
		const DEFAULT_MODAL_OPACITY = 1;
		/** CSS variable carrying the current popup fill weight (a percentage). */
		const MODAL_FILL_VAR = "--dsh-dream-skin-modal-fill";
		/** localStorage key holding the composer (chat input) fill opacity (0..1). */
		const COMPOSER_OPACITY_KEY = "dsh-dream-skin:composer-opacity";
		/** Default composer fill opacity — 0% transparency. */
		const DEFAULT_COMPOSER_OPACITY = 1;
		/** CSS variable carrying the composer fill weight (a percentage). */
		const COMPOSER_FILL_VAR = "--dsh-dream-skin-composer-fill";
		/**
		 * CSS variable carrying the live glass blur radius (px) for every
		 * backdrop-filter surface (composer card). Fed by the same 壁纸模糊
		 * slider, so ONE blur knob drives the whole material (user review
		 * round 2: sliders must not fight each other).
		 */
		const GLASS_BLUR_VAR = "--dsh-dream-skin-glass-blur";
		/**
		 * Live glass CHARACTER var (round-5): the material chip's personality —
		 * a ready-to-use `saturate() brightness()` filter tail. The chip sets
		 * it; the blur NUMBER stays owned by the 壁纸模糊 slider (GLASS_BLUR_VAR).
		 */
		const GLASS_TONE_VAR = "--dsh-dream-skin-glass-tone";
		/**
		 * Live glass TINT var (round-8): the glass FILL color. Frosted keeps the
		 * skin base color (tinted frost); liquid uses NEUTRAL WHITE — the Apple
		 * "clear glass" read. Without this the liquid glass mixed the warm skin
		 * base (nebula's violet) at high saturation and read as TEA-COLORED.
		 */
		const GLASS_TINT_VAR = "--dsh-dream-skin-glass-tint";
		/**
		 * Fill WEIGHT scale (round-9): the composer slider's fill percentage is
		 * multiplied by this per-material factor. Apple's glass reads "white" via
		 * LIGHT (brightness + a sheen layer), not via fill — a full-weight white
		 * fill just paints a white board. Frosted keeps 1 (tinted skin base wants
		 * the user's full weight); liquid caps at 0.15 so even "0% transparency"
		 * stays a translucent pane.
		 */
		const GLASS_FILL_SCALE_VAR = "--dsh-dream-skin-glass-fill-scale";
		/**
		 * Round-17: liquid glass thickness (px of extra backdrop blur). The
		 * composer slider drives it (0 → 0px, max → +24px) — "more opaque =
		 * thicker glass", the one refraction expression Chromium can actually
		 * render. Consumed only by the liquid ::before rule.
		 */
		const LIQUID_THICKNESS_VAR = "--dsh-dream-skin-liquid-thickness";
		/** Fallback blur when nothing was persisted yet (frosted default). */
		const DEFAULT_GLASS_BLUR = 14;
		/** localStorage key holding the chosen glass material preset id. */
		const MATERIAL_PRESET_KEY = "dsh-dream-skin:material-preset";
		/** One-shot marker: factory defaults were already applied at first boot. */
		const FACTORY_APPLIED_KEY = "dsh-dream-skin:factory-applied";
		/**
		 * Persistent provenance snapshot (blue-team T1): a JSON map of every key
		 * the factory seeding wrote, with the value it seeded. Unlike the
		 * session-scoped factorySealed set this SURVIVES page reloads, so a
		 * same-origin reload (where applyFactoryDefaults early-returns and no
		 * factory write runs) can still tell "still the untouched factory
		 * value" from "the user changed this". Never pushed to the host file.
		 */
		const FACTORY_SNAPSHOT_KEY = "dsh-dream-skin:factory-seeded";
		/** No backdrop compositing by default; explicit glass choices remain available. */
		const DEFAULT_MATERIAL_PRESET = "none";
		const MATERIAL_PRESETS = [
            { id: "none", tone: "none", tint: "var(--dsh-dream-skin-composer-base, var(--dsw-alias-bg-base))", fillScale: 1, blurScale: 0,
              swatch: { blur: 0, filter: "none", fill: "var(--dsw-alias-bg-base)", rim: "var(--dsw-alias-border-l2)", sheen: false } },
			{
				id: "frosted", tone: "saturate(1.6) brightness(1.08)",
				// Tinted frost: fills with the skin base color (existing look).
				tint: "var(--dsh-dream-skin-composer-base, var(--dsw-alias-bg-base))",
				// Full slider weight — the tinted frost needs it for readability.
				fillScale: 1,
				// Full blur radius — frosted IS the thick glass.
				blurScale: 1,
				// Swatch = a REAL glass lens over a striped backdrop (round-9):
				// the backdrop stays sharp (it IS the "wallpaper"); the LENS on top
				// is an actual backdrop-filter pane you see the stripes THROUGH —
				// exactly how the real composer glass works.
				// frosted: thick milk — heavy blur, milky fill, soft rim.
				swatch: { blur: 5, filter: "saturate(1.3) brightness(1.12)", fill: "rgba(255,255,255,0.38)", rim: "rgba(255,255,255,0.35)", sheen: false }
			},
			{
				id: "liquid",
				// Apple recipe (WebTricks): low blur + HIGH saturation + a bare
				// brightness nudge. Round-8 (user): a gentle tone let the skin's
				// warm base read TEA-colored on the composer glass; the higher
				// saturation keeps the refraction vivid without coloring it.
				// (Blue-team B5: this object previously carried a duplicate `tone`
				// key — the earlier value silently lost to this one.)
				tone: "saturate(1.8) brightness(1.02) contrast(1.04)",
				// Neutral WHITE fill at a LOW cap (round-12: 0.45 still board-white
				// once the user lowers transparency — three white layers stacked:
				// fill + sheen + brightness lift buried the refraction). 0.15 keeps
				// just a breath of white; the glass READ comes from the refraction.
				tint: "#ffffff",
				fillScale: 0.15,
				// THIN glass (round-10): liquid only gets a quarter of the blur
				// radius — heavy blur is what made it read as white FROSTED glass.
				// Refraction needs the backdrop mostly sharp underneath.
				// Scaling happens EXACTLY ONCE, in applyMaterialBlur() (blue-team
				// B3: the CSS rule used to multiply by 0.25 a second time).
				blurScale: 0.25,
				// liquid: CLEAR glass — minimal blur, vivid backdrop, thin bright
				// rim + a diagonal sheen (Apple's "thick lit pane" read).
				swatch: { blur: 1.5, filter: "saturate(1.9) brightness(1.06)", fill: "rgba(255,255,255,0.10)", rim: "rgba(255,255,255,0.5)", sheen: true }
			}
		];
		/**
		 * localStorage key holding the last user-committed concrete built-in theme
		 * preference (`light` or `dark`). DSH's own `ui-theme.preference` scope is
		 * only persisted in the host settings file for LOOPBACK browsers; a remote
		 * browser (e.g. served over HTTP) keeps it process-local, so a client
		 * reload / connection reset — such as switching the agent preset — resets a
		 * built-in `dark`/`light` choice back to the `system` default. We keep our
		 * own copy of the last concrete built-in preference here (surviving through
		 * the same 3-layer storage) and re-apply it when a reload falls back to
		 * `system`, mirroring the third-party skin restore. Absent when the user
		 * never left `system` or explicitly chose it.
		 */
		const BUILTIN_LAST_KEY = "dsh-dream-skin:builtin-last";
		/** Built-in base colors used when no skin token owns a scheme. */
		const BUILTIN_BASE = {
			light: "rgb(255, 255, 255)",
			dark: "rgb(21, 21, 23)"
		};

		/**
		 * The curated "Mirage" skin catalog. Every skin is a third-party theme
		 * for the built-in ThemeRuntime: an id, the base palette it builds on
		 * (colorScheme drives body[data-ds-dark-theme]), and --dsw-alias-*
		 * overrides applied as inline custom properties on <body> by ui-layout's
		 * ThemePresenter. Values are concrete CSS colors (no var() indirection),
		 * tuned per skin for contrast on both surface and text roles. Add your
		 * own entries here and they appear in the Settings picker automatically.
		 */
		const SKINS = [
{
  "id": "tavern-terracotta",
  "colorScheme": "light",
  "schemeFamily": "tavern-terracotta",
  "tokens": {
    "--dsw-alias-brand-primary": "#cc785c",
    "--dsw-alias-brand-text": "#ffffff",
    "--dsw-alias-bg-base": "#faf9f5",
    "--dsw-alias-bg-layer-1": "#f5f0e8",
    "--dsw-alias-bg-layer-2": "#fffdf8",
    "--dsw-alias-bg-layer-3": "#ffffff",
    "--dsw-alias-bg-module-platform": "#faf9f5",
    "--dsw-alias-bg-overlay": "#faf9f5",
    "--dsw-alias-label-primary": "#141413",
    "--dsw-alias-label-secondary": "#6c6a64",
    "--dsw-alias-label-tertiary": "#827d75",
    "--dsw-alias-border-l1": "#eee8e0",
    "--dsw-alias-border-l2": "#e6dfd8",
    "--dsw-specific-sidebar-fill": "#faf9f5",
    "--dsw-specific-input-major": "#ffffff",
    "--dsw-specific-bubble": "#f5f0e8",
    "--dsw-specific-bubble-highlight": "color-mix(in srgb, #cc785c 16%, transparent)",
    "--dsw-alias-button-primary-hover": "#a9583e",
    "--dsw-alias-button-primary-dimmed": "color-mix(in srgb, #cc785c 16%, transparent)",
    "--dsw-alias-state-business-primary": "#cc785c",
    "--dsw-alias-state-business-tertiary": "color-mix(in srgb, #cc785c 16%, transparent)",
    "--dsw-alias-interactive-bg-hover": "color-mix(in srgb, #cc785c 12%, transparent)",
    "--dsw-alias-interactive-bg-active": "color-mix(in srgb, #cc785c 24%, transparent)",
    "--dsw-alias-markdown-code-block": "#f5f0e8",
    "--dsw-alias-markdown-inline-code": "#eee8e0"
  },
  "label": "酒馆 · 暖陶土"
},
{
  "id": "tavern-terracotta-dark",
  "colorScheme": "dark",
  "schemeFamily": "tavern-terracotta",
  "tokens": {
    "--dsw-alias-brand-primary": "#d4896c",
    "--dsw-alias-brand-text": "#181715",
    "--dsw-alias-bg-base": "#181715",
    "--dsw-alias-bg-layer-1": "#252320",
    "--dsw-alias-bg-layer-2": "#302c28",
    "--dsw-alias-bg-layer-3": "#38332e",
    "--dsw-alias-bg-module-platform": "#181715",
    "--dsw-alias-bg-overlay": "#252320",
    "--dsw-alias-label-primary": "#faf9f5",
    "--dsw-alias-label-secondary": "#a09d96",
    "--dsw-alias-label-tertiary": "#8c8880",
    "--dsw-alias-border-l1": "#34302b",
    "--dsw-alias-border-l2": "#464039",
    "--dsw-specific-sidebar-fill": "#181715",
    "--dsw-specific-input-major": "#252320",
    "--dsw-specific-bubble": "#302c28",
    "--dsw-specific-bubble-highlight": "color-mix(in srgb, #d4896c 16%, transparent)",
    "--dsw-alias-button-primary-hover": "#e8a890",
    "--dsw-alias-button-primary-dimmed": "color-mix(in srgb, #d4896c 16%, transparent)",
    "--dsw-alias-state-business-primary": "#d4896c",
    "--dsw-alias-state-business-tertiary": "color-mix(in srgb, #d4896c 16%, transparent)",
    "--dsw-alias-interactive-bg-hover": "color-mix(in srgb, #d4896c 12%, transparent)",
    "--dsw-alias-interactive-bg-active": "color-mix(in srgb, #d4896c 24%, transparent)",
    "--dsw-alias-markdown-code-block": "#252320",
    "--dsw-alias-markdown-inline-code": "#302c28"
  },
  "label": "暖陶土 · 深色"
},
			{
				id: "abyss",
				colorScheme: "dark",
				tokens: {
					// iOS/Linear 清透冷调重构：干净中性深灰底 + 白色低透明浮升玻璃面板 + 鲜亮靛蓝强调
					"--dsw-alias-bg-base": "#101014",
					"--dsw-alias-bg-layer-1": "#1b1e28",
					"--dsw-alias-bg-layer-2": "rgba(26, 30, 42, 0.85)",
					"--dsw-alias-bg-layer-3": "#1a1d27",
					"--dsw-alias-bg-module-platform": "#151821",
					"--dsw-alias-bg-overlay": "rgba(24, 24, 30, 0.86)",
					"--dsw-specific-input-major": "rgba(255, 255, 255, 0.08)",
					"--dsw-specific-tip": "rgba(30, 33, 46, 0.9)",
					"--dsw-alias-border-l1": "rgba(255, 255, 255, 0.07)",
					"--dsw-alias-border-l2": "rgba(255, 255, 255, 0.13)",
					"--dsw-alias-label-primary": "#f4f5f7",
					"--dsw-alias-label-secondary": "#a5adb8",
					"--dsw-alias-label-tertiary": "#7b838f",
					"--dsw-alias-brand-primary": "#5e6ad2",
					"--dsw-specific-bubble": "rgba(37, 42, 58, 0.9)",
					"--dsw-specific-bubble-highlight": "rgba(94, 106, 210, 0.16)",
					"--dsw-specific-selector": "rgba(255, 255, 255, 0.10)",
					"--dsw-alias-brand-text": "#ffffff",
					"--dsw-alias-button-primary-hover": "#6f7be0",
					"--dsw-alias-button-primary-dimmed": "rgba(94, 106, 210, 0.16)",
					"--dsw-alias-state-business-primary": "#5e6ad2",
					"--dsw-alias-state-business-tertiary": "rgba(94, 106, 210, 0.16)",
					"--dsw-alias-interactive-bg-hover": "rgba(94, 106, 210, 0.16)",
					"--dsw-alias-interactive-bg-active": "rgba(94, 106, 210, 0.26)",
					"--dsw-alias-markdown-code-block": "rgba(0, 0, 0, 0.35)",
					"--dsw-alias-markdown-inline-code": "rgba(255, 255, 255, 0.09)",
					"--dsw-specific-sidebar-fill": "rgba(16, 16, 20, 0.92)",
					"--dsw-specific-sidebar-nav-item-active": "rgba(255, 255, 255, 0.09)",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.05)",
					"--dsw-alias-scrollbar-bg-l1": "rgba(255, 255, 255, 0.09)",
					"--dsw-alias-scrollbar-bg-l2": "rgba(255, 255, 255, 0.14)",
					"--dsw-alias-scrollbar-hover-l1": "rgba(255, 255, 255, 0.2)",
					"--dsw-alias-scrollbar-hover-l2": "rgba(255, 255, 255, 0.2)"
				}
			},
			{
				id: "aurora",
				colorScheme: "dark",
				tokens: {
					// iOS/Linear 清透冷调重构：青绿→天蓝低温系
					"--dsw-alias-bg-base": "#0e1316",
					"--dsw-alias-bg-layer-1": "#162128",
					"--dsw-alias-bg-layer-2": "rgba(22, 32, 34, 0.85)",
					"--dsw-alias-bg-layer-3": "#182128",
					"--dsw-alias-bg-module-platform": "#131c20",
					"--dsw-alias-bg-overlay": "rgba(18, 24, 27, 0.86)",
					"--dsw-specific-input-major": "rgba(255, 255, 255, 0.08)",
					"--dsw-specific-tip": "rgba(24, 35, 36, 0.9)",
					"--dsw-alias-border-l1": "rgba(110, 231, 183, 0.10)",
					"--dsw-alias-border-l2": "rgba(110, 231, 183, 0.18)",
					"--dsw-alias-label-primary": "#eefaf4",
					"--dsw-alias-label-secondary": "#9fc9b8",
					"--dsw-alias-label-tertiary": "#74a494",
					"--dsw-alias-brand-primary": "#2dd4bf",
					"--dsw-specific-bubble": "rgba(30, 42, 44, 0.9)",
					"--dsw-specific-bubble-highlight": "rgba(45, 212, 191, 0.14)",
					"--dsw-specific-selector": "rgba(255, 255, 255, 0.10)",
					"--dsw-alias-brand-text": "#03211b",
					"--dsw-alias-button-primary-hover": "#45e0cd",
					"--dsw-alias-button-primary-dimmed": "rgba(45, 212, 191, 0.14)",
					"--dsw-alias-state-business-primary": "#2dd4bf",
					"--dsw-alias-state-business-tertiary": "rgba(45, 212, 191, 0.14)",
					"--dsw-alias-interactive-bg-hover": "rgba(45, 212, 191, 0.14)",
					"--dsw-alias-interactive-bg-active": "rgba(45, 212, 191, 0.22)",
					"--dsw-alias-markdown-code-block": "rgba(0, 0, 0, 0.32)",
					"--dsw-alias-markdown-inline-code": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-fill": "rgba(14, 19, 22, 0.92)",
					"--dsw-specific-sidebar-nav-item-active": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.045)",
					"--dsw-alias-scrollbar-bg-l1": "rgba(255, 255, 255, 0.085)",
					"--dsw-alias-scrollbar-bg-l2": "rgba(255, 255, 255, 0.13)",
					"--dsw-alias-scrollbar-hover-l1": "rgba(255, 255, 255, 0.2)",
					"--dsw-alias-scrollbar-hover-l2": "rgba(255, 255, 255, 0.2)"
				}
			},
			{
				id: "nebula",
				colorScheme: "dark",
				tokens: {
					// iOS/Linear 清透冷调重构：紫青低温系
					"--dsw-alias-bg-base": "#12101a",
					"--dsw-alias-bg-layer-1": "#1c1a2a",
					"--dsw-alias-bg-layer-2": "rgba(30, 27, 44, 0.85)",
					"--dsw-alias-bg-layer-3": "#1c1a28",
					"--dsw-alias-bg-module-platform": "#171523",
					"--dsw-alias-bg-overlay": "rgba(22, 20, 30, 0.86)",
					"--dsw-specific-input-major": "rgba(255, 255, 255, 0.08)",
					"--dsw-specific-tip": "rgba(32, 28, 46, 0.9)",
					"--dsw-alias-border-l1": "rgba(196, 181, 253, 0.10)",
					"--dsw-alias-border-l2": "rgba(196, 181, 253, 0.18)",
					"--dsw-alias-label-primary": "#f3f0fb",
					"--dsw-alias-label-secondary": "#b6a8d9",
					"--dsw-alias-label-tertiary": "#8a7cb0",
					"--dsw-alias-brand-primary": "#8b7cf6",
					"--dsw-specific-bubble": "rgba(40, 36, 56, 0.9)",
					"--dsw-specific-bubble-highlight": "rgba(139, 124, 246, 0.14)",
					"--dsw-specific-selector": "rgba(255, 255, 255, 0.10)",
					"--dsw-alias-brand-text": "#0d0a1c",
					"--dsw-alias-button-primary-hover": "#9d90f8",
					"--dsw-alias-button-primary-dimmed": "rgba(139, 124, 246, 0.14)",
					"--dsw-alias-state-business-primary": "#8b7cf6",
					"--dsw-alias-state-business-tertiary": "rgba(139, 124, 246, 0.14)",
					"--dsw-alias-interactive-bg-hover": "rgba(139, 124, 246, 0.14)",
					"--dsw-alias-interactive-bg-active": "rgba(139, 124, 246, 0.22)",
					"--dsw-alias-markdown-code-block": "rgba(0, 0, 0, 0.32)",
					"--dsw-alias-markdown-inline-code": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-fill": "rgba(18, 16, 26, 0.92)",
					"--dsw-specific-sidebar-nav-item-active": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.045)",
					"--dsw-alias-scrollbar-bg-l1": "rgba(255, 255, 255, 0.085)",
					"--dsw-alias-scrollbar-bg-l2": "rgba(255, 255, 255, 0.13)",
					"--dsw-alias-scrollbar-hover-l1": "rgba(255, 255, 255, 0.2)",
					"--dsw-alias-scrollbar-hover-l2": "rgba(255, 255, 255, 0.2)"
				}
			},
			{
				id: "ember",
				colorScheme: "dark",
				tokens: {
					// iOS/Linear 清透冷调重构：暖橙但干净克制
					"--dsw-alias-bg-base": "#16110d",
					"--dsw-alias-bg-layer-1": "#211a15",
					"--dsw-alias-bg-layer-2": "rgba(36, 28, 20, 0.85)",
					"--dsw-alias-bg-layer-3": "#231b15",
					"--dsw-alias-bg-module-platform": "#1b1712",
					"--dsw-alias-bg-overlay": "rgba(28, 20, 15, 0.86)",
					"--dsw-specific-input-major": "rgba(255, 255, 255, 0.08)",
					"--dsw-specific-tip": "rgba(38, 28, 20, 0.9)",
					"--dsw-alias-border-l1": "rgba(253, 186, 116, 0.10)",
					"--dsw-alias-border-l2": "rgba(253, 186, 116, 0.18)",
					"--dsw-alias-label-primary": "#fdf0e6",
					"--dsw-alias-label-secondary": "#d0a98a",
					"--dsw-alias-label-tertiary": "#a48266",
					"--dsw-alias-brand-primary": "#f59e5b",
					"--dsw-specific-bubble": "rgba(48, 38, 28, 0.9)",
					"--dsw-specific-bubble-highlight": "rgba(245, 158, 91, 0.14)",
					"--dsw-specific-selector": "rgba(255, 255, 255, 0.10)",
					"--dsw-alias-brand-text": "#1f0f06",
					"--dsw-alias-button-primary-hover": "#f8b06f",
					"--dsw-alias-button-primary-dimmed": "rgba(245, 158, 91, 0.14)",
					"--dsw-alias-state-business-primary": "#f59e5b",
					"--dsw-alias-state-business-tertiary": "rgba(245, 158, 91, 0.14)",
					"--dsw-alias-interactive-bg-hover": "rgba(245, 158, 91, 0.14)",
					"--dsw-alias-interactive-bg-active": "rgba(245, 158, 91, 0.22)",
					"--dsw-alias-markdown-code-block": "rgba(0, 0, 0, 0.32)",
					"--dsw-alias-markdown-inline-code": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-fill": "rgba(22, 17, 13, 0.92)",
					"--dsw-specific-sidebar-nav-item-active": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.045)",
					"--dsw-alias-scrollbar-bg-l1": "rgba(255, 255, 255, 0.085)",
					"--dsw-alias-scrollbar-bg-l2": "rgba(255, 255, 255, 0.13)",
					"--dsw-alias-scrollbar-hover-l1": "rgba(255, 255, 255, 0.2)",
					"--dsw-alias-scrollbar-hover-l2": "rgba(255, 255, 255, 0.2)"
				}
			},
			{
				id: "midnight",
				colorScheme: "dark",
				tokens: {
					// iOS/Linear 清透冷调重构：中性纯黑（保留 OLED 但清透）
					"--dsw-alias-bg-base": "#0b0b0e",
					"--dsw-alias-bg-layer-1": "#17171f",
					"--dsw-alias-bg-layer-2": "rgba(22, 22, 28, 0.85)",
					"--dsw-alias-bg-layer-3": "#181820",
					"--dsw-alias-bg-module-platform": "#11111a",
					"--dsw-alias-bg-overlay": "rgba(20, 20, 25, 0.86)",
					"--dsw-specific-input-major": "rgba(255, 255, 255, 0.08)",
					"--dsw-specific-tip": "rgba(26, 26, 32, 0.9)",
					"--dsw-alias-border-l1": "rgba(255, 255, 255, 0.06)",
					"--dsw-alias-border-l2": "rgba(255, 255, 255, 0.12)",
					"--dsw-alias-label-primary": "#f2f2f6",
					"--dsw-alias-label-secondary": "#a4a4b2",
					"--dsw-alias-label-tertiary": "#787884",
					"--dsw-alias-brand-primary": "#7c8cff",
					"--dsw-specific-bubble": "rgba(30, 30, 38, 0.9)",
					"--dsw-specific-bubble-highlight": "rgba(124, 140, 255, 0.14)",
					"--dsw-specific-selector": "rgba(255, 255, 255, 0.10)",
					"--dsw-alias-brand-text": "#05050f",
					"--dsw-alias-button-primary-hover": "#93a1ff",
					"--dsw-alias-button-primary-dimmed": "rgba(124, 140, 255, 0.14)",
					"--dsw-alias-state-business-primary": "#7c8cff",
					"--dsw-alias-state-business-tertiary": "rgba(124, 140, 255, 0.14)",
					"--dsw-alias-interactive-bg-hover": "rgba(124, 140, 255, 0.12)",
					"--dsw-alias-interactive-bg-active": "rgba(124, 140, 255, 0.20)",
					"--dsw-alias-markdown-code-block": "rgba(0, 0, 0, 0.4)",
					"--dsw-alias-markdown-inline-code": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-fill": "rgba(11, 11, 14, 0.92)",
					"--dsw-specific-sidebar-nav-item-active": "rgba(255, 255, 255, 0.085)",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.045)",
					"--dsw-alias-scrollbar-bg-l1": "rgba(255, 255, 255, 0.085)",
					"--dsw-alias-scrollbar-bg-l2": "rgba(255, 255, 255, 0.13)",
					"--dsw-alias-scrollbar-hover-l1": "rgba(255, 255, 255, 0.2)",
					"--dsw-alias-scrollbar-hover-l2": "rgba(255, 255, 255, 0.2)"
				}
			},
			{
				id: "ivory",
				colorScheme: "light",
				tokens: {
					// iOS 扁平化：极简白、平色分层、克制系统灰，无半透明浑浊层
					"--dsw-alias-bg-base": "#f4f4f6",
					"--dsw-alias-bg-layer-1": "#ffffff",
					"--dsw-alias-bg-layer-2": "#ffffff",
					"--dsw-alias-bg-layer-3": "#fafafc",
					"--dsw-alias-bg-module-platform": "#ededf0",
					"--dsw-alias-bg-overlay": "#ffffff",
					"--dsw-specific-input-major": "#ffffff",
					"--dsw-specific-tip": "#ffffff",
					"--dsw-alias-border-l1": "rgba(0, 0, 0, 0.08)",
					"--dsw-alias-border-l2": "rgba(0, 0, 0, 0.14)",
					"--dsw-alias-label-primary": "#1c1c1e",
					"--dsw-alias-label-secondary": "#6e6e73",
					"--dsw-alias-label-tertiary": "#86868b",
					"--dsw-alias-brand-primary": "#0071e3",
					"--dsw-specific-bubble": "#ffffff",
					"--dsw-specific-bubble-highlight": "rgba(0, 113, 227, 0.08)",
					"--dsw-specific-selector": "rgba(0, 0, 0, 0.04)",
					"--dsw-alias-brand-text": "#ffffff",
					"--dsw-alias-button-primary-hover": "#3395ff",
					"--dsw-alias-button-primary-dimmed": "rgba(0, 113, 227, 0.12)",
					"--dsw-alias-state-business-primary": "#0071e3",
					"--dsw-alias-state-business-tertiary": "rgba(0, 113, 227, 0.12)",
					"--dsw-alias-interactive-bg-hover": "rgba(0, 113, 227, 0.10)",
					"--dsw-alias-interactive-bg-active": "rgba(0, 113, 227, 0.16)",
					"--dsw-alias-markdown-code-block": "#f2f2f4",
					"--dsw-alias-markdown-inline-code": "rgba(0, 113, 227, 0.10)",
					"--dsw-specific-sidebar-fill": "#f4f4f6",
					"--dsw-specific-sidebar-nav-item-active": "#e4e4e8",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(0, 0, 0, 0.04)",
					"--dsw-alias-scrollbar-bg-l1": "#d1d1d6",
					"--dsw-alias-scrollbar-bg-l2": "#c0c0c6",
					"--dsw-alias-scrollbar-hover-l1": "#a6a6ad",
					"--dsw-alias-scrollbar-hover-l2": "#a6a6ad"
				}
			},
			{
				id: "mist",
				colorScheme: "light",
				tokens: {
					// 液态玻璃：真正的清透半透明白 + blur，冷蓝光晕透出，面板浮于其上
					"--dsw-alias-bg-base": "#e9eef6",
					"--dsw-alias-bg-layer-1": "rgba(255, 255, 255, 0.5)",
					"--dsw-alias-bg-layer-2": "rgba(255, 255, 255, 0.6)",
					"--dsw-alias-bg-layer-3": "rgba(255, 255, 255, 0.68)",
					"--dsw-alias-bg-module-platform": "rgba(243, 247, 252, 0.9)",
					"--dsw-alias-bg-overlay": "rgba(255, 255, 255, 0.55)",
					"--dsw-specific-input-major": "rgba(255, 255, 255, 0.45)",
					"--dsw-specific-tip": "rgba(255, 255, 255, 0.5)",
					"--dsw-alias-border-l1": "rgba(30, 41, 59, 0.10)",
					"--dsw-alias-border-l2": "rgba(30, 41, 59, 0.16)",
					"--dsw-alias-label-primary": "#0f1b33",
					"--dsw-alias-label-secondary": "#3d5270",
					"--dsw-alias-label-tertiary": "#6b80a0",
					"--dsw-alias-brand-primary": "#2196f3",
					"--dsw-specific-bubble": "rgba(255, 255, 255, 0.7)",
					"--dsw-specific-bubble-highlight": "rgba(33, 150, 243, 0.12)",
					"--dsw-specific-selector": "rgba(255, 255, 255, 0.5)",
					"--dsw-alias-brand-text": "#ffffff",
					"--dsw-alias-button-primary-hover": "#42a5f5",
					"--dsw-alias-button-primary-dimmed": "rgba(33, 150, 243, 0.14)",
					"--dsw-alias-state-business-primary": "#2196f3",
					"--dsw-alias-state-business-tertiary": "rgba(33, 150, 243, 0.14)",
					"--dsw-alias-interactive-bg-hover": "rgba(33, 150, 243, 0.12)",
					"--dsw-alias-interactive-bg-active": "rgba(33, 150, 243, 0.20)",
					"--dsw-alias-markdown-code-block": "rgba(255, 255, 255, 0.6)",
					"--dsw-alias-markdown-inline-code": "rgba(33, 150, 243, 0.12)",
					"--dsw-specific-sidebar-fill": "rgba(255, 255, 255, 0.5)",
					"--dsw-specific-sidebar-nav-item-active": "rgba(255, 255, 255, 0.72)",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(255, 255, 255, 0.35)",
					"--dsw-alias-scrollbar-bg-l1": "rgba(30, 41, 59, 0.18)",
					"--dsw-alias-scrollbar-bg-l2": "rgba(30, 41, 59, 0.24)",
					"--dsw-alias-scrollbar-hover-l1": "rgba(30, 41, 59, 0.34)",
					"--dsw-alias-scrollbar-hover-l2": "rgba(30, 41, 59, 0.34)"
				}
			},
			{
				id: "rose",
				colorScheme: "light",
				tokens: {
					// Google Material 扁平彩色：明快的品牌粉 + 紫点缀，干净扁平，无浑浊
					"--dsw-alias-bg-base": "#f7f0f3",
					"--dsw-alias-bg-layer-1": "#ffffff",
					"--dsw-alias-bg-layer-2": "#fffdfd",
					"--dsw-alias-bg-layer-3": "#fdeef3",
					"--dsw-alias-bg-module-platform": "#f6e9ef",
					"--dsw-alias-bg-overlay": "#ffffff",
					"--dsw-specific-input-major": "#ffffff",
					"--dsw-specific-tip": "#fff7fa",
					"--dsw-alias-border-l1": "rgba(154, 55, 118, 0.12)",
					"--dsw-alias-border-l2": "rgba(154, 55, 118, 0.20)",
					"--dsw-alias-label-primary": "#3a1424",
					"--dsw-alias-label-secondary": "#8a4a63",
					"--dsw-alias-label-tertiary": "#a86b82",
					"--dsw-alias-brand-primary": "#e91e63",
					"--dsw-specific-bubble": "#ffffff",
					"--dsw-specific-bubble-highlight": "rgba(233, 30, 99, 0.10)",
					"--dsw-specific-selector": "rgba(233, 30, 99, 0.06)",
					"--dsw-alias-brand-text": "#ffffff",
					"--dsw-alias-button-primary-hover": "#f06292",
					"--dsw-alias-button-primary-dimmed": "rgba(233, 30, 99, 0.12)",
					"--dsw-alias-state-business-primary": "#e91e63",
					"--dsw-alias-state-business-tertiary": "rgba(233, 30, 99, 0.12)",
					"--dsw-alias-interactive-bg-hover": "rgba(233, 30, 99, 0.10)",
					"--dsw-alias-interactive-bg-active": "rgba(233, 30, 99, 0.18)",
					"--dsw-alias-markdown-code-block": "#fdeef3",
					"--dsw-alias-markdown-inline-code": "rgba(233, 30, 99, 0.10)",
					"--dsw-specific-sidebar-fill": "#f6e9ef",
					"--dsw-specific-sidebar-nav-item-active": "#f5d4e2",
					"--dsw-specific-sidebar-nav-item-hover": "rgba(233, 30, 99, 0.06)",
					"--dsw-alias-scrollbar-bg-l1": "#e5c7d4",
					"--dsw-alias-scrollbar-bg-l2": "#d9b3c4",
					"--dsw-alias-scrollbar-hover-l1": "#c392ab",
					"--dsw-alias-scrollbar-hover-l2": "#c392ab"
				}
			}
		];

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"skin.title": "皮肤",
			"skin.default": "默认",
			"skin.abyss": "沉静蓝",
			"skin.aurora": "极光青",
			"skin.nebula": "星云紫",
			"skin.ember": "余烬橙",
			"skin.midnight": "午夜黑",
			"skin.ivory": "iOS 扁平",
			"skin.mist": "干净明亮",
			"skin.rose": "Material 粉",
			"background.title": "背景图片（壁纸）",
			"background.choose": "选择图片",
			"background.remove": "移除图片",
			"background.opacity": "壁纸透明度",
			"background.blur": "壁纸模糊",
			"background.sidebarOpacity": "侧边栏透明度",
			"background.sidebarLink": "侧边栏跟随壁纸透明度（关闭后可分别调节）",
			"background.sidebarOpacityHint": "拖动本滑块会自动关闭上面的「跟随壁纸」，改为单独调节侧边栏",
			"glass.title": "玻璃效果",
			"glass.help": "透明度滑杆：越往右越透明、越能透出壁纸；越往左越实、文字越清晰。启用玻璃效果时，模糊滑杆同时驱动壁纸与玻璃表面的模糊。选择无玻璃效果可关闭背景玻璃模糊，减少渲染开销；壁纸模糊仍由滑杆单独控制。",
			"material.none": "无玻璃效果（默认）",
            "material.none.desc": "关闭背景玻璃模糊，减少渲染开销，适合手机使用",
            "material.frosted": "毛玻璃",
			"material.liquid": "液态玻璃",
			"material.frosted.desc": "经典毛玻璃：奶霜质感，文字更清晰",
			"material.liquid.desc": "通透润泽，折射感更强，更显壁纸",
			"material.hint": "默认不使用玻璃效果。毛玻璃与液态玻璃可手动启用；切换不会改动已保存的透明度和壁纸模糊数值。",
			"composer.opacity": "输入框透明度",
			"composer.hint": "越往右拉输入框越透明、越能透出壁纸；越往左越实、文字越清晰。",
			"background.hint": "图片显示在主内容区与侧边栏的半透明底上，消息等内层表面保持不透明以保证可读性",
			"background.history": "最近使用",
			"background.historyApply": "点击换回这张壁纸",
			"accent.title": "强调色（Accent）",
			"accent.pick": "选色…",
			"accent.random": "随机",
			"accent.clear": "恢复主题色",
			"accent.hint": "为当前皮肤设置一个自定义强调色（叠加层，不影响皮肤本身）；点「恢复主题色」回到皮肤默认强调色",
			"packs.title": "主题包（本地库）",
			"packs.import": "导入主题包…",
			"packs.share": "复制分享链接",
			"packs.apply": "应用",
			"packs.surprise": "换一个试试",
			"packs.remove": "移除",
			"packs.empty": "还没有主题包。导入一个 JSON 主题包，或内置皮肤会显示在「皮肤」行。",
			"packs.imported": "已导入「{name}」✓",
			"packs.importFailed": "导入失败：{error}",
			"packs.rejected": "主题包被拒绝——\n{errors}",
			"packs.removed": "已移除「{name}」",
			"packs.shareCopied": "已复制 ✓",
			"packs.shareFailed": "复制失败，请手动复制：{url}",
			"packs.shareUnavailable": "当前是内置外观（默认/浅色/深色），没有可分享的主题——先在上方选择一个皮肤或主题包再分享",
			"packs.export": "导出主题包文件",
			"bg2.title": "高级壁纸（URL / 渐变）",
			"bg2.local": "本地图片",
			"bg2.url": "图片链接",
			"bg2.gradient": "渐变",
			"bg2.apply": "应用链接",
			"bg2.autodim": "自动弱化（聚焦任务时不喧宾夺主）",
			"bg2.urlInvalid": "链接不被支持：仅支持 http/https 或 data:image 图片链接",
			"bg2.urlLoadFailed": "图片加载失败，请检查链接是否有效",
			"bg2.refreshUrlOnly": "定时更新仅对“图片链接”壁纸生效，请先在上方选择“图片链接”",
			"bg2.refresh": "定时自动更新（按周期重拉此链接，适合每日壁纸 API）",
			"bg2.refreshHours": "更新间隔（小时）",
			"bg2.remove": "清除壁纸",
			"modal.title": "弹窗透明度",
			"modal.hint": "控制下拉菜单 / 浮层 / 弹窗的底填充透明度——越往右越透、越能透出背后的内容；越往左越实、文字越清晰。"
		};

		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"skin.title": "Skins",
			"skin.default": "Default",
			"skin.abyss": "Deep Blue",
			"skin.aurora": "Aurora Green",
			"skin.nebula": "Nebula Purple",
			"skin.ember": "Ember Amber",
			"skin.midnight": "Midnight OLED",
			"skin.ivory": "iOS Flat",
			"skin.mist": "Clear Bright",
			"skin.rose": "Material Pink",
			"background.title": "Wallpaper",
			"background.choose": "Choose image",
			"background.remove": "Remove",
			"background.opacity": "Wallpaper transparency",
			"background.blur": "Wallpaper blur",
			"background.sidebarOpacity": "Sidebar transparency",
			"background.sidebarLink": "Link sidebar transparency to the wallpaper (turn off to control it separately)",
			"background.sidebarOpacityHint": "Dragging this slider turns the wallpaper link off and controls the sidebar on its own",
			"glass.title": "Glass effect",
			"glass.help": "Transparency sliders: right = more see-through, left = more solid (crisper text). The blur slider drives both the wallpaper and every glass surface. Materials (frosted / liquid) only switch the glass character — they never move any slider value.",
			"material.none": "No glass (default)",
            "material.none.desc": "Disable backdrop effects for lighter rendering, especially on mobile",
            "material.frosted": "Frosted glass",
			"material.liquid": "Liquid glass",
			"material.frosted.desc": "Classic frost: milky texture, crisper text",
			"material.liquid.desc": "Clearer and glossier, with stronger refraction",
			"material.hint": "Materials only switch the glass character (frosted = milky frost, liquid = glossy refraction) — no slider value ever changes; transparency and blur always follow your manual settings.",
			"composer.opacity": "Input box transparency",
			"composer.hint": "Slide right for a more see-through input box; slide left for a more solid one with crisper text.",
			"background.hint": "The image shows through the translucent main canvas and sidebar; inner surfaces stay opaque for readability",
			"background.history": "Recent",
			"background.historyApply": "Click to switch back",
			"accent.title": "Accent",
			"accent.pick": "Pick…",
			"accent.random": "Random",
			"accent.clear": "Reset to theme",
			"accent.hint": "Set a custom accent color for the active skin (an override layer — the skin itself is untouched). Reset to return to the skin's default accent.",
			"packs.title": "Theme Packs (local)",
			"packs.import": "Import pack…",
			"packs.share": "Copy share link",
			"packs.apply": "Apply",
			"packs.surprise": "Surprise me",
			"packs.remove": "Remove",
			"packs.empty": "No packs yet. Import a JSON theme pack, or pick a built-in skin from the Skins row.",
			"packs.imported": "Imported \"{name}\" ✓",
			"packs.importFailed": "Import failed: {error}",
			"packs.rejected": "Theme pack rejected —\n{errors}",
			"packs.removed": "Removed \"{name}\"",
			"packs.shareCopied": "Copied ✓",
			"packs.shareFailed": "Copy failed — copy it manually: {url}",
			"packs.shareUnavailable": "A built-in appearance (Default/light/dark) is active — nothing to share. Pick a skin or theme pack above first.",
			"packs.export": "Export theme file",
			"bg2.title": "Advanced Wallpaper (URL / gradient)",
			"bg2.local": "Local image",
			"bg2.url": "Image URL",
			"bg2.gradient": "Gradient",
			"bg2.apply": "Apply link",
			"bg2.autodim": "Auto-dim (gently fade while focusing tasks)",
			"bg2.urlInvalid": "Unsupported link — only http/https or data:image image URLs are supported",
			"bg2.urlLoadFailed": "Failed to load the image — please check the link",
			"bg2.refreshUrlOnly": "Scheduled refresh only works with Image URL wallpapers — pick “Image URL” above first",
			"bg2.refresh": "Auto refresh (re-fetch this link on a schedule — great for daily wallpaper APIs)",
			"bg2.refreshHours": "Refresh interval (hours)",
			"bg2.remove": "Clear wallpaper",
			"modal.title": "Popup transparency",
			"modal.hint": "Controls how see-through dropdown menus / overlays / popups are — slide right to let the content behind show through, left to keep text crisp."
		};

		/** JA dictionary (community translation). */
		const ja = {
			"skin.title": "スキン",
			"skin.default": "デフォルト",
			"skin.abyss": "ディープブルー",
			"skin.aurora": "オーロラグリーン",
			"skin.nebula": "星雲パープル",
			"skin.ember": "残り火アンバー",
			"skin.midnight": "ミッドナイトOLED",
			"skin.ivory": "iOSフラット",
			"skin.mist": "クリアブライト",
			"skin.rose": "マテリアルピンク",
			"background.title": "背景画像（壁紙）",
			"background.choose": "画像を選択",
			"background.remove": "画像を削除",
			"background.opacity": "壁紙の透明度",
			"background.blur": "壁紙のぼかし",
			"background.sidebarOpacity": "サイドバーの透明度",
			"background.sidebarLink": "サイドバーの透明度を壁紙に連動（オフで個別調整）",
			"background.sidebarOpacityHint": "このスライダーを動かすと壁紙との連動が自動で解除され、サイドバーを個別に調整できます",
			"glass.title": "ガラス効果",
			"glass.help": "透明度スライダー：右ほど透けて壁紙が見え、左ほど不透明で文字がくっきり。ぼかしスライダーは壁紙とすべてのガラス面のぼかしをまとめて調整します。素材（すりガラス／リキッドグラス）は質感だけを切り替え、スライダーの数値は一切変えません。",
			"material.frosted": "すりガラス",
			"material.liquid": "リキッドグラス",
			"material.frosted.desc": "定番のすりガラス：乳白色で文字がくっきり",
			"material.liquid.desc": "より透明で光沢があり、屈折感が強い",
			"material.hint": "素材はガラスの質感だけを切り替えます（すりガラス＝乳白、リキッド＝光沢ある屈折）。スライダーの数値は変わりません。透明度・ぼかしは常に手動設定どおりです。",
			"composer.opacity": "入力欄の透明度",
			"composer.hint": "右に動かすほど入力欄が透けて壁紙が見え、左ほど不透明で文字がくっきりします。",
			"background.hint": "画像は半透明のメイン表示領域とサイドバーの背面に表示されます。メッセージなど内側の面は読みやすさのため不透明のままです",
			"background.history": "最近使ったもの",
			"background.historyApply": "クリックでこの壁紙に戻る",
			"accent.title": "アクセントカラー",
			"accent.pick": "色を選ぶ…",
			"accent.random": "ランダム",
			"accent.clear": "テーマカラーに戻す",
			"accent.hint": "現在のスキンにカスタムのアクセントカラーを設定します（オーバーライド層であり、スキン自体には影響しません）。「テーマカラーに戻す」でスキン既定のアクセントカラーに戻ります",
			"packs.title": "テーマパック（ローカル）",
			"packs.import": "テーマパックを読み込む…",
			"packs.share": "共有リンクをコピー",
			"packs.apply": "適用",
			"packs.surprise": "おまかせ",
			"packs.remove": "削除",
			"packs.empty": "テーマパックはまだありません。JSON テーマパックを読み込むか、「スキン」の行から内蔵スキンを選んでください",
			"packs.imported": "「{name}」を読み込みました ✓",
			"packs.importFailed": "読み込みに失敗しました：{error}",
			"packs.rejected": "テーマパックが拒否されました——\n{errors}",
			"packs.removed": "「{name}」を削除しました",
			"packs.shareCopied": "コピーしました ✓",
			"packs.shareFailed": "コピーに失敗しました。手動でコピーしてください：{url}",
			"packs.shareUnavailable": "内蔵の外観（デフォルト/ライト/ダーク）が選択されているため、共有できるテーマがありません。先に上でスキンまたはテーマパックを選んでください",
			"packs.export": "テーマファイルをエクスポート",
			"bg2.title": "詳細壁紙（URL / グラデーション）",
			"bg2.local": "ローカル画像",
			"bg2.url": "画像 URL",
			"bg2.gradient": "グラデーション",
			"bg2.apply": "リンクを適用",
			"bg2.autodim": "自動ディム（タスクに集中している間は控えめに薄暗く）",
			"bg2.urlInvalid": "サポート外のリンクです：http/https または data:image の画像URLのみ利用できます",
			"bg2.urlLoadFailed": "画像の読み込みに失敗しました。リンクを確認してください",
			"bg2.refreshUrlOnly": "定期更新は「画像 URL」の壁紙でのみ動作します — 先に上で「画像 URL」を選択してください",
			"bg2.refresh": "定期自動更新（このリンクを定期的に再取得 — 日替わり壁紙 API に最適）",
			"bg2.refreshHours": "更新間隔（時間）",
			"bg2.remove": "壁紙をクリア",
			"modal.title": "ポップアップの透明度",
			"modal.hint": "ドロップダウンメニュー / オーバーレイ / ポップアップの透け方を調整します。右ほど背後が透け、左ほど文字がはっきりします。"
		};

		/** KO dictionary (community translation). */
		const ko = {
			"skin.title": "스킨",
			"skin.default": "기본",
			"skin.abyss": "딥 블루",
			"skin.aurora": "오로라 그린",
			"skin.nebula": "성운 퍼플",
			"skin.ember": "잔불 앰버",
			"skin.midnight": "미드나잇 OLED",
			"skin.ivory": "iOS 플랫",
			"skin.mist": "클리어 브라이트",
			"skin.rose": "머티리얼 핑크",
			"background.title": "배경 이미지 (배경화면)",
			"background.choose": "이미지 선택",
			"background.remove": "이미지 제거",
			"background.opacity": "배경화면 투명도",
			"background.blur": "배경화면 흐림",
			"background.sidebarOpacity": "사이드바 투명도",
			"background.sidebarLink": "사이드바 투명도를 배경화면에 연동 (끄면 개별 조절)",
			"background.sidebarOpacityHint": "이 슬라이더를 움직이면 배경화면 연동이 자동으로 해제되어 사이드바를 따로 조절할 수 있습니다",
			"glass.title": "글래스 효과",
			"glass.help": "투명도 슬라이더: 오른쪽일수록 투명해 배경이 비치고, 왼쪽일수록 단단해져 글자가 선명합니다. 흐림 슬라이더는 배경화면과 모든 유리 표면의 흐림을 함께 조절합니다. 재질(새틴/리퀴드)은 질감만 바꾸며 슬라이더 값은 절대 변경하지 않습니다.",
			"material.frosted": "새틴 글래스",
			"material.liquid": "리퀴드 글래스",
			"material.frosted.desc": "클래식 새틴: 뿌연 질감, 더 선명한 글자",
			"material.liquid.desc": "더 투명하고 광택이 있으며 굴절감이 강함",
			"material.hint": "재질은 유리 질감만 바꿉니다(새틴=뿌연 유리, 리퀴드=광택 굴절). 슬라이더 값은 변하지 않으며 투명도·흐림은 항상 수동 설정을 따릅니다.",
			"composer.opacity": "입력창 투명도",
			"composer.hint": "오른쪽으로 올릴수록 입력창이 투명해져 배경이 비치고, 왼쪽일수록 단단해져 글자가 선명합니다.",
			"background.hint": "이미지가 메인 콘텐츠 영역과 사이드바의 반투명 배경에 표시됩니다. 메시지 같은 내부 표면은 가독성을 위해 불투명하게 유지됩니다.",
			"background.history": "최근 사용",
			"background.historyApply": "클릭하면 이 배경화면으로 되돌아갑니다",
			"accent.title": "강조색 (Accent)",
			"accent.pick": "색상 선택…",
			"accent.random": "랜덤",
			"accent.clear": "테마 색상으로 복원",
			"accent.hint": "현재 스킨에 사용자 지정 강조색을 설정합니다 (오버레이 레이어 — 스킨 자체는 그대로 유지). 「테마 색상으로 복원」을 누르면 스킨의 기본 강조색으로 돌아갑니다.",
			"packs.title": "테마 팩 (로컬 라이브러리)",
			"packs.import": "테마 팩 가져오기…",
			"packs.share": "공유 링크 복사",
			"packs.apply": "적용",
			"packs.surprise": "랜덤으로 바꾸기",
			"packs.remove": "제거",
			"packs.empty": "아직 테마 팩이 없습니다. JSON 테마 팩을 가져오거나, 내장 스킨은 「스킨」 행에서 선택하세요.",
			"packs.imported": "「{name}」을(를) 가져왔습니다 ✓",
			"packs.importFailed": "가져오기 실패: {error}",
			"packs.rejected": "테마 팩이 거부되었습니다:\n{errors}",
			"packs.removed": "「{name}」을(를) 제거했습니다",
			"packs.shareCopied": "복사했습니다 ✓",
			"packs.shareFailed": "복사에 실패했습니다. 수동으로 복사해 주세요: {url}",
			"packs.shareUnavailable": "내장 외관(기본/라이트/다크)이 선택되어 공유할 테마가 없습니다. 먼저 위에서 스킨 또는 테마 팩을 선택하세요",
			"packs.export": "테마 파일 내보내기",
			"bg2.title": "고급 배경화면 (URL / 그라데이션)",
			"bg2.local": "로컬 이미지",
			"bg2.url": "이미지 링크",
			"bg2.gradient": "그라데이션",
			"bg2.apply": "링크 적용",
			"bg2.autodim": "자동으로 은은해지기 (작업에 집중할 때 방해하지 않도록)",
			"bg2.urlInvalid": "지원하지 않는 링크입니다. http/https 또는 data:image 이미지 URL만 사용할 수 있습니다",
			"bg2.urlLoadFailed": "이미지를 불러오지 못했습니다. 링크를 확인해 주세요",
			"bg2.refreshUrlOnly": "정기 업데이트는 '이미지 URL' 배경화면에서만 작동합니다 — 먼저 위에서 '이미지 URL'을 선택하세요",
			"bg2.refresh": "정기 자동 업데이트 (이 링크를 주기적으로 다시 가져옴 — 매일 바뀌는 배경화면 API에 적합)",
			"bg2.refreshHours": "업데이트 간격 (시간)",
			"bg2.remove": "배경화면 지우기",
			"modal.title": "팝업 투명도",
			"modal.hint": "드롭다운 메뉴 / 오버레이 / 팝업의 투명도를 조절합니다. 오른쪽일수록 배경이 비치고, 왼쪽일수록 텍스트가 선명합니다."
		};

		/** ES dictionary (community translation). */
		const es = {
			"skin.title": "Pieles",
			"skin.default": "Por defecto",
			"skin.abyss": "Azul profundo",
			"skin.aurora": "Aurora verde",
			"skin.nebula": "Nebulosa púrpura",
			"skin.ember": "Ámbar",
			"skin.midnight": "OLED medianoche",
			"skin.ivory": "iOS Flat",
			"skin.mist": "Brillo limpio",
			"skin.rose": "Material rosa",
			"background.title": "Fondo de pantalla",
			"background.choose": "Elegir imagen",
			"background.remove": "Quitar imagen",
			"background.opacity": "Transparencia del fondo",
			"background.blur": "Desenfoque del fondo",
			"background.sidebarOpacity": "Transparencia de la barra lateral",
			"background.sidebarLink": "Vincular la transparencia de la barra lateral al fondo (apagar para ajustarla aparte)",
			"background.sidebarOpacityHint": "Al mover este control se desactiva el vínculo con el fondo y la barra lateral se ajusta por separado",
			"glass.title": "Efecto de cristal",
			"glass.help": "Deslizadores de transparencia: derecha = más transparente, izquierda = más sólido (texto más nítido). El desenfoque controla el fondo y todas las superficies de cristal. Los materiales (esmerilado/líquido) solo cambian el carácter del cristal: nunca mueven ningún valor.",
			"material.frosted": "Cristal esmerilado",
			"material.liquid": "Cristal líquido",
			"material.frosted.desc": "Esmerilado clásico: textura lechosa, texto más nítido",
			"material.liquid.desc": "Más transparente y brillante, con mayor refracción",
			"material.hint": "Los materiales solo cambian el carácter del cristal (esmerilado = escarcha lechosa, líquido = refracción brillante): ningún valor cambia; transparencia y desenfoque siguen tus ajustes manuales.",
			"composer.opacity": "Transparencia del cuadro de entrada",
			"composer.hint": "Desliza a la derecha para un cuadro más transparente; a la izquierda, más sólido y con texto más nítido.",
			"background.hint": "La imagen se muestra bajo el fondo translúcido del área de contenido principal y la barra lateral; las superficies internas (como los mensajes) permanecen opacas para garantizar la legibilidad",
			"background.history": "Recientes",
			"background.historyApply": "Haz clic para volver a este fondo",
			"accent.title": "Color de acento",
			"accent.pick": "Elegir…",
			"accent.random": "Aleatorio",
			"accent.clear": "Restablecer color del tema",
			"accent.hint": "Define un color de acento personalizado para la piel activa (es una capa de superposición: la piel en sí no se modifica). Pulsa «Restablecer color del tema» para volver al acento predeterminado de la piel.",
			"packs.title": "Paquetes de temas (locales)",
			"packs.import": "Importar paquete…",
			"packs.share": "Copiar enlace para compartir",
			"packs.apply": "Aplicar",
			"packs.surprise": "Sorpréndeme",
			"packs.remove": "Quitar",
			"packs.empty": "Aún no hay paquetes. Importa un paquete de temas JSON o elige una piel integrada en la fila «Pieles».",
			"packs.imported": "Se importó «{name}» ✓",
			"packs.importFailed": "Error al importar: {error}",
			"packs.rejected": "Paquete rechazado —\n{errors}",
			"packs.removed": "Se quitó «{name}»",
			"packs.shareCopied": "Copiado ✓",
			"packs.shareFailed": "No se pudo copiar — cópialo manualmente: {url}",
			"packs.shareUnavailable": "Hay una apariencia integrada activa (Predeterminado/claro/oscuro): no hay nada que compartir. Elige antes una piel o paquete arriba.",
			"packs.export": "Exportar archivo de tema",
			"bg2.title": "Fondo avanzado (URL / degradado)",
			"bg2.local": "Imagen local",
			"bg2.url": "URL de la imagen",
			"bg2.gradient": "Degradado",
			"bg2.apply": "Aplicar enlace",
			"bg2.autodim": "Atenuación automática (se desvanece suavemente mientras te concentras en las tareas)",
			"bg2.urlInvalid": "Enlace no admitido: solo se permiten URLs de imágenes http/https o data:image",
			"bg2.urlLoadFailed": "No se pudo cargar la imagen. Comprueba el enlace",
			"bg2.refreshUrlOnly": "La actualización automática solo funciona con fondos de URL de imagen — elige «URL de la imagen» arriba primero",
			"bg2.refresh": "Actualización automática (vuelve a cargar este enlace periódicamente — ideal para fondos diarios)",
			"bg2.refreshHours": "Intervalo de actualización (horas)",
			"bg2.remove": "Quitar fondo",
			"modal.title": "Transparencia de las ventanas emergentes",
			"modal.hint": "Controla la transparencia del relleno de menús / superposiciones / ventanas emergentes: hacia la derecha se ve el contenido de atrás; hacia la izquierda el texto queda nítido."
		};

		/** FR dictionary (community translation). */
		const fr = {
			"skin.title": "Apparence",
			"skin.default": "Par défaut",
			"skin.abyss": "Bleu profond",
			"skin.aurora": "Aurora vert",
			"skin.nebula": "Nébuleuse violette",
			"skin.ember": "Ambre",
			"skin.midnight": "OLED minuit",
			"skin.ivory": "iOS Flat",
			"skin.mist": "Clair net",
			"skin.rose": "Material rose",
			"background.title": "Fond d'écran",
			"background.choose": "Choisir une image",
			"background.remove": "Retirer l'image",
			"background.opacity": "Transparence du fond",
			"background.blur": "Flou du fond",
			"background.sidebarOpacity": "Transparence de la barre latérale",
			"background.sidebarLink": "Lier la transparence de la barre latérale au fond (désactiver pour régler séparément)",
			"background.sidebarOpacityHint": "Déplacer ce curseur désactive la liaison au fond d'écran et règle la barre latérale séparément",
			"glass.title": "Effet de verre",
			"glass.help": "Curseurs de transparence : droite = plus transparent, gauche = plus solide (texte plus net). Le flou pilote le fond et toutes les surfaces de verre. Les matières (dépoli/liquide) ne changent que le caractère du verre — elles ne déplacent aucune valeur.",
			"material.frosted": "Verre dépoli",
			"material.liquid": "Verre liquide",
			"material.frosted.desc": "Dépoli classique : texture laiteuse, texte plus net",
			"material.liquid.desc": "Plus transparent et brillant, réfraction plus forte",
			"material.hint": "Les matières ne changent que le caractère du verre (dépoli = givre laiteux, liquide = réfraction brillante) — aucune valeur ne bouge ; transparence et flou suivent vos réglages.",
			"composer.opacity": "Transparence de la zone de saisie",
			"composer.hint": "Glisse vers la droite pour plus de transparence ; vers la gauche, la zone devient plus solide et le texte plus net.",
			"background.hint": "L'image transparaît sous le canevas principal et la barre latérale translucides ; les surfaces intérieures (messages, etc.) restent opaques pour préserver la lisibilité.",
			"background.history": "Récents",
			"background.historyApply": "Clique pour revenir à ce fond d'écran",
			"accent.title": "Couleur d'accent",
			"accent.pick": "Choisir…",
			"accent.random": "Aléatoire",
			"accent.clear": "Rétablir la couleur du thème",
			"accent.hint": "Définis une couleur d'accent personnalisée pour l'apparence active (une surcouche — l'apparence elle-même reste intacte) ; « Rétablir la couleur du thème » revient à l'accent par défaut.",
			"packs.title": "Packs de thèmes (locaux)",
			"packs.import": "Importer un pack…",
			"packs.share": "Copier le lien de partage",
			"packs.apply": "Appliquer",
			"packs.surprise": "Surprends-moi",
			"packs.remove": "Retirer",
			"packs.empty": "Pas encore de packs. Importe un pack de thème JSON, ou retrouve les apparences intégrées dans la ligne « Apparence ».",
			"packs.imported": "Pack « {name} » importé ✓",
			"packs.importFailed": "Échec de l'import : {error}",
			"packs.rejected": "Pack rejeté —\n{errors}",
			"packs.removed": "« {name} » retiré",
			"packs.shareCopied": "Copié ✓",
			"packs.shareFailed": "Échec de la copie — copiez-le manuellement : {url}",
			"packs.shareUnavailable": "Une apparence intégrée est active (Par défaut/clair/sombre) — rien à partager. Choisissez d'abord un skin ou un pack ci-dessus.",
			"packs.export": "Exporter le fichier de thème",
			"bg2.title": "Fond d'écran avancé (URL / dégradé)",
			"bg2.local": "Image locale",
			"bg2.url": "URL de l'image",
			"bg2.gradient": "Dégradé",
			"bg2.apply": "Appliquer le lien",
			"bg2.autodim": "Atténuation auto (s'estompe en douceur pendant la concentration)",
			"bg2.urlInvalid": "Lien non pris en charge : seuls les URLs http/https ou data:image sont autorisés",
			"bg2.urlLoadFailed": "Échec du chargement de l'image. Vérifiez le lien",
			"bg2.refreshUrlOnly": "L'actualisation auto ne fonctionne qu'avec les fonds « URL d'image » — choisissez d'abord « URL de l'image » ci-dessus",
			"bg2.refresh": "Actualisation auto (recharge ce lien périodiquement — idéal pour les fonds quotidiens)",
			"bg2.refreshHours": "Intervalle de mise à jour (heures)",
			"bg2.remove": "Effacer le fond d'écran",
			"modal.title": "Transparence des fenêtres contextuelles",
			"modal.hint": "Contrôle la transparence du remplissage des menus / superpositions / fenêtres contextuelles : vers la droite, le contenu derrière transparaît ; vers la gauche, le texte reste net."
		};

		/** DE dictionary (community translation). */
		const de = {
			"skin.title": "Skins",
			"skin.default": "Standard",
			"skin.abyss": "Tiefes Blau",
			"skin.aurora": "Aurora Grün",
			"skin.nebula": "Nebel Lila",
			"skin.ember": "Bernstein",
			"skin.midnight": "OLED Mitternacht",
			"skin.ivory": "iOS Flat",
			"skin.mist": "Klar hell",
			"skin.rose": "Material Pink",
			"background.title": "Hintergrundbild (Wallpaper)",
			"background.choose": "Bild auswählen",
			"background.remove": "Bild entfernen",
			"background.opacity": "Wallpaper-Transparenz",
			"background.blur": "Wallpaper-Unschärfe",
			"background.sidebarOpacity": "Transparenz der Seitenleiste",
			"background.sidebarLink": "Seitenleisten-Transparenz an Wallpaper koppeln (ausschalten für getrennte Regelung)",
			"background.sidebarOpacityHint": "Beim Ziehen dieses Reglers wird die Kopplung an das Wallpaper gelöst und die Seitenleiste separat eingestellt",
			"glass.title": "Glas-Effekt",
			"glass.help": "Transparenz-Regler: rechts = durchsichtiger, links = solider (schärferer Text). Die Unschärfe steuert Hintergrund und alle Glasflächen gemeinsam. Materialien (Milchglas/Flüssig) wechseln nur den Glas-Charakter – sie verändern keine Werte.",
			"material.frosted": "Milchglas",
			"material.liquid": "Flüssiges Glas",
			"material.frosted.desc": "Klassisches Milchglas: milchige Textur, schärferer Text",
			"material.liquid.desc": "Klarer und glänzender, mit stärkerer Brechung",
			"material.hint": "Materialien wechseln nur den Glas-Charakter (Milchglas = milchiger Frost, Flüssig = glänzende Brechung) – keine Werte ändern sich; Transparenz und Unschärfe folgen deinen manuellen Einstellungen.",
			"composer.opacity": "Eingabefeld-Transparenz",
			"composer.hint": "Nach rechts = durchsichtigeres Eingabefeld; nach links = solider mit klarerem Text.",
			"background.hint": "Das Bild scheint durch die halbtransparente Hauptfläche und die Seitenleiste; innere Flächen wie Nachrichten bleiben deckend, damit alles gut lesbar bleibt.",
			"background.history": "Zuletzt verwendet",
			"background.historyApply": "Klicken, um zurückzuwechseln",
			"accent.title": "Akzentfarbe (Accent)",
			"accent.pick": "Farbe wählen…",
			"accent.random": "Zufall",
			"accent.clear": "Auf Theme zurücksetzen",
			"accent.hint": "Legt eine eigene Akzentfarbe für den aktiven Skin fest (eine Überlagerung – der Skin selbst bleibt unberührt). Über »Auf Theme zurücksetzen« kehrst du zur Standard-Akzentfarbe des Skins zurück.",
			"packs.title": "Theme-Pakete (lokal)",
			"packs.import": "Theme-Paket importieren…",
			"packs.share": "Freigabelink kopieren",
			"packs.apply": "Anwenden",
			"packs.surprise": "Überrasch mich",
			"packs.remove": "Entfernen",
			"packs.empty": "Noch keine Theme-Pakete. Importiere ein JSON-Theme-Paket oder wähle einen integrierten Skin in der Zeile »Skins«.",
			"packs.imported": "»{name}« importiert ✓",
			"packs.importFailed": "Import fehlgeschlagen: {error}",
			"packs.rejected": "Theme-Paket abgelehnt —\n{errors}",
			"packs.removed": "»{name}« entfernt",
			"packs.shareCopied": "Kopiert ✓",
			"packs.shareFailed": "Kopieren fehlgeschlagen — bitte manuell kopieren: {url}",
			"packs.shareUnavailable": "Ein integriertes Erscheinungsbild ist aktiv (Standard/Hell/Dunkel) — nichts zu teilen. Wähle zuerst oben einen Skin oder ein Theme-Paket.",
			"packs.export": "Theme-Datei exportieren",
			"bg2.title": "Erweiterte Wallpaper (URL / Verlauf)",
			"bg2.local": "Lokales Bild",
			"bg2.url": "Bild-URL",
			"bg2.gradient": "Verlauf",
			"bg2.apply": "Link anwenden",
			"bg2.autodim": "Automatisch dimmen (sanft verblassen, während du dich auf Aufgaben konzentrierst)",
			"bg2.urlInvalid": "Nicht unterstützter Link – nur http/https- oder data:image-Bild-URLs sind erlaubt",
			"bg2.urlLoadFailed": "Bild konnte nicht geladen werden. Bitte prüfe den Link",
			"bg2.refreshUrlOnly": "Die automatische Aktualisierung funktioniert nur bei Wallpapern per Bild-URL — wähle zuerst oben „Bild-URL“",
			"bg2.refresh": "Automatisch aktualisieren (diesen Link regelmäßig neu laden — ideal für tägliche Wallpaper-APIs)",
			"bg2.refreshHours": "Aktualisierungsintervall (Stunden)",
			"bg2.remove": "Wallpaper entfernen",
			"modal.title": "Transparenz von Popups",
			"modal.hint": "Regelt die Transparenz von Dropdown-Menüs / Overlays / Popups – nach rechts scheint der Hintergrund durch, nach links bleibt der Text klar."
		};

		/** RU dictionary (community translation). */
		const ru = {
			"skin.title": "Скины",
			"skin.default": "По умолчанию",
			"skin.abyss": "Глубокий синий",
			"skin.aurora": "Аврора зелёный",
			"skin.nebula": "Туманность фиолетовый",
			"skin.ember": "Янтарь",
			"skin.midnight": "OLED полночь",
			"skin.ivory": "iOS Flat",
			"skin.mist": "Чистая яркость",
			"skin.rose": "Material розовый",
			"background.title": "Обои",
			"background.choose": "Выбрать изображение",
			"background.remove": "Удалить",
			"background.opacity": "Прозрачность обоев",
			"background.blur": "Размытие обоев",
			"background.sidebarOpacity": "Прозрачность боковой панели",
			"background.sidebarLink": "Связать прозрачность боковой панели с обоями (выкл — для раздельной настройки)",
			"background.sidebarOpacityHint": "При перетаскивании этого ползунка связь с обоями отключается, и боковую панель можно настроить отдельно",
			"glass.title": "Эффект стекла",
			"glass.help": "Ползунки прозрачности: вправо — прозрачнее (фон виден), влево — плотнее (текст чётче). Ползунок размытия управляет фоном и всеми стеклянными поверхностями сразу. Материалы (матовое/жидкое) меняют только характер стекла — значения ползунков не трогают.",
			"material.frosted": "Матовое стекло",
			"material.liquid": "Жидкое стекло",
			"material.frosted.desc": "Классическое матовое: молочная текстура, чётче текст",
			"material.liquid.desc": "Прозрачнее и глянцевее, сильнее преломление",
			"material.hint": "Материалы меняют только характер стекла (матовое = молочный иней, жидкое = глянцевое преломление) — значения не меняются; прозрачность и размытие следуют вашим ручным настройкам.",
			"composer.opacity": "Прозрачность поля ввода",
			"composer.hint": "Вправо — поле ввода прозрачнее и фон виден; влево — плотнее и текст чётче.",
			"background.hint": "Изображение просвечивает сквозь полупрозрачный фон основной области и боковой панели; внутренние поверхности (сообщения и т. п.) остаются непрозрачными ради читабельности",
			"background.history": "Недавние",
			"background.historyApply": "Нажмите, чтобы вернуть эти обои",
			"accent.title": "Акцентный цвет",
			"accent.pick": "Выбрать цвет…",
			"accent.random": "Случайно",
			"accent.clear": "Вернуть цвет темы",
			"accent.hint": "Задайте свой акцентный цвет для активного скина (это наложение — сам скин не меняется). Нажмите «Вернуть цвет темы», чтобы вернуться к акцентному цвету скина по умолчанию.",
			"packs.title": "Пакеты тем (локальная библиотека)",
			"packs.import": "Импортировать пакет…",
			"packs.share": "Скопировать ссылку",
			"packs.apply": "Применить",
			"packs.surprise": "Удиви меня",
			"packs.remove": "Удалить",
			"packs.empty": "Пакетов тем пока нет. Импортируйте пакет в формате JSON — или выберите встроенный скин в разделе «Скины».",
			"packs.imported": "Импортировано: «{name}» ✓",
			"packs.importFailed": "Не удалось импортировать: {error}",
			"packs.rejected": "Пакет тем отклонён —\n{errors}",
			"packs.removed": "Удалено: «{name}»",
			"packs.shareCopied": "Скопировано ✓",
			"packs.shareFailed": "Не удалось скопировать — скопируйте вручную: {url}",
			"packs.shareUnavailable": "Активен встроенный внешний вид (По умолчанию/светлая/тёмная) — делиться нечем. Сначала выберите скин или пакет тем выше.",
			"packs.export": "Экспортировать файл темы",
			"bg2.title": "Расширенные обои (URL / градиент)",
			"bg2.local": "Локальное изображение",
			"bg2.url": "Ссылка на изображение",
			"bg2.gradient": "Градиент",
			"bg2.apply": "Применить ссылку",
			"bg2.autodim": "Автоприглушение (плавно затухает при фокусе на задачах)",
			"bg2.urlInvalid": "Неподдерживаемая ссылка — разрешены только URL http/https или data:image",
			"bg2.urlLoadFailed": "Не удалось загрузить изображение. Проверьте ссылку",
			"bg2.refreshUrlOnly": "Автообновление работает только с обоями «URL изображения» — сначала выберите «URL изображения» выше",
			"bg2.refresh": "Автообновление (периодически перезагружать эту ссылку — идеально для ежедневных обоев)",
			"bg2.refreshHours": "Интервал обновления (часы)",
			"bg2.remove": "Очистить обои",
			"modal.title": "Прозрачность всплывающих окон",
			"modal.hint": "Регулирует прозрачность заливки выпадающих меню / оверлеев / всплывающих окон: вправо — просвечивает фон, влево — текст чётче."
		};

		//#endregion

		//#region dsh-dream-skin: persistence (host-backed, origin-independent)
		/**
		 * Persistence seam. Values live in three places:
		 *
		 *  1. an in-memory Map (`stateCache`) — the synchronous read/write
		 *     surface every feature uses;
		 *  2. localStorage — a same-origin fallback so a page reload on the
		 *     same origin still works, and so the first paint before the host
		 *     round-trip has correct values;
		 *  3. the host state file (`$DSH_HOME/dream-skin.json`, via the fenced
		 *     `/dream-skin/api` route) — the durable, origin-independent
		 *     source of truth that survives the desktop app's per-launch
		 *     random port (localStorage alone is lost because the origin —
		 *     scheme+host+port — changes every restart).
		 *
		 * Writes update the cache + localStorage immediately (sync), then are
		 * debounced and pushed to the host as a full-state replacement. On
		 * boot the host state is fetched once; keys not touched this session
		 * are adopted from it, and `onHostReady` re-applies the visual state.
		 */
		/**
		 * API endpoint, derived from `document.baseURI` so a deployment behind
		 * a gateway that serves the app under a sub-path (e.g. fnOS reverse
		 * proxy at `/dsh/`) resolves the route relative to that base —
		 * `<base href="./">` already makes asset URLs sub-path-safe, and this
		 * extends the same guarantee to the persistence API. On a root
		 * deployment (no `<base>`, no trailing path) this is exactly
		 * `/dream-skin/api`, unchanged.
		 */
		const HOST_API = new URL("dream-skin/api", document.baseURI || "http://localhost/").pathname;
		/** In-memory key -> string|null cache (null = cleared/absent). */
		const stateCache = new Map();
		/** Keys written (or cleared) this session — the host must not overwrite them. */
		const writtenKeys = new Set();
		/**
		 * Keys written by the factory-defaults seeding THIS SESSION. Those
		 * writes are PROVISIONAL: the durable host value must always win over
		 * them (blue-team B1). Cross-session provenance is tracked by the
		 * persistent FACTORY_SNAPSHOT_KEY (survives reloads — session seals
		 * do not), consumed by isFactorySeededValue().
		 */
		const factorySealed = new Set();
		/**
		 * In-memory mirror of the persistent provenance snapshot (key -> seeded
		 * value). Populated by loadFactorySnapshot() at boot, updated by the
		 * factory seeding, consumed by isFactorySeededValue()/hasUserState().
		 */
		const factorySnapshot = new Map();
		/**
		 * Host-push gate (blue-team B1 race): the boot-time factory seeding
		 * must never leak into a push, and the host GET may not have resolved
		 * when the first debounced push would fire — pushing before adoption
		 * would write the provisional factory state over the user's durable
		 * file. Factory writes are simply NEVER pushed (isFactorySeededValue
		 * filters them out of every patch); the gate additionally holds any
		 * user write that lands before the probe settles, then flushes it.
		 */
		let hostProbeSettled = false;
		let pendingHostSync = false;
		/** Debounce timer for host pushes. */
		let hostSyncTimer = null;
		/** Callback invoked after the host state is applied (set by apply). */
		let onHostReady = null;

		/** Schedule a debounced push of the USER state to the host. */
		function scheduleHostSync() {
			if (!hostProbeSettled) {
				// Boot probe in flight: stash the request, the settled handler
				// pushes once with the merged state.
				pendingHostSync = true;
				return;
			}
			if (hostSyncTimer !== null) return;
			hostSyncTimer = setTimeout(() => {
				hostSyncTimer = null;
				pushStateToHost();
			}, 200);
		}

		/** Push the USER state (factory provenance stripped) to the host file. */
		async function pushStateToHost() {
			const patch = {};
			for (const [key, value] of stateCache) {
				// Only keys actually WRITTEN this session may go out. A read caches
				// absent keys as null (readStorage); pushing those nulls would ERASE
				// the user's durable accent/packs/favorites/history on the host the
				// moment any late write flushes after a slow/failed probe
				// (post-release review 🟠-2). A deliberate user clear goes through
				// writeStorage(key, null) and IS in writtenKeys — still pushed.
				if (!writtenKeys.has(key)) continue;
				// Factory seeds and the provenance bookkeeping are never the
				// user's config — pushing them would bake the shipped look into
				// dream-skin.json (blue-team B1/A1) or leak internals.
				if (isFactorySeededValue(key, value)) continue;
				if (key === FACTORY_APPLIED_KEY || key === FACTORY_SNAPSHOT_KEY) continue;
				patch[key] = value;
			}
			// Nothing user-owned to persist (pure factory boot): skip the
			// round-trip entirely instead of pushing an empty/seed-only patch.
			if (Object.keys(patch).length === 0) return;
			try {
				await fetch(HOST_API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ method: "set", patch })
				});
			} catch {
				// host unavailable — the cache + localStorage still hold the values
			}
		}

		/** Fetch the host state at boot and adopt keys not written this session. */
		async function loadFromHost() {
			// Blue-team T2/A4 + post-release review 🟠-1: the probe must not hang
			// forever — a stalled host (accepts the connection, never answers, or
			// delivers headers but stalls the body) would keep the push gate shut
			// for the whole session and silently defer every user write to the
			// next boot. The 4s cap covers BOTH fetch and res.json(); the losing
			// timer is always cleared below.
			const probe = (async () => {
				const res = await fetch(HOST_API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ method: "get" })
				});
				return res.json();
			})();
			// If the timeout wins the race, a LATER probe failure (e.g. slow
			// connect error after 4s) must not surface as an unhandled rejection.
			probe.catch(() => {});
			let timeoutId = null;
			let parsed;
			try {
				parsed = await Promise.race([
					probe,
					new Promise((_, reject) => {
						timeoutId = setTimeout(() => reject(new Error("host probe timeout")), 4000);
					})
				]);
			} catch {
				// host unreachable / timed out — keep using localStorage
				clearTimeout(timeoutId);
				// A timed-out probe's rejection is already consumed by the race;
				// nothing else can observe it. Release the gate and bail.
				hostProbeSettled = true;
				// Issue #51: the probe is the wallpaper-seed gate's only trigger on
				// this path too — an unreachable host on a TRUE first install must
				// still get the shipped wallpaper (just later), and a dynamic-port
				// restart whose host is briefly unavailable must not be left
				// wallpaper-less forever. report=false = "no host decision seen".
				if (typeof seedDeferredFactoryWallpaper === "function") {
					try { seedDeferredFactoryWallpaper(false); } catch {}
				}
				if (pendingHostSync) {
					pendingHostSync = false;
					scheduleHostSync();
				}
				return;
			}
			clearTimeout(timeoutId);
			timeoutId = null;
			try {
				if (parsed === null || typeof parsed !== "object" || parsed.ok !== true || typeof parsed.value !== "object" || parsed.value === null) return;
				const hostKeys = Object.keys(parsed.value);
				let adopted = false;
				for (const [key, value] of Object.entries(parsed.value)) {
					// Factory-seeded keys are PROVISIONAL (blue-team B1): the durable
					// host value always wins over the "first paint" seed, otherwise a
					// desktop restart (fresh origin = empty localStorage = factory
					// seeding) would shadow AND then destroy the user's real config.
					if (writtenKeys.has(key) && !factorySealed.has(key)) continue;
					const str = value === null ? null : typeof value === "string" ? value : String(value);
					// Adopting over a factory seed releases the seal AND the provenance:
					// the durable value is the user's, not the shipped look.
					factorySealed.delete(key);
					removeFactoryProvenance(key);
					stateCache.set(key, str);
					try {
						if (str === null) window.localStorage.removeItem(key);
						else window.localStorage.setItem(key, str);
					} catch {
						// storage unavailable — cache still holds the value
					}
					adopted = true;
				}
				// Migration: an empty host file means this is the first boot with
				// host persistence — seed it with whatever the local (same-origin)
				// state holds so previously set preferences survive origin changes.
				// A pure-factory boot (nothing durable yet) must NOT push: the
				// factory seed would then be written into the host file as if it
				// were the user's own config (blue-team B1). pushStateToHost now
				// filters factory provenance anyway, so this is belt-and-braces.
				if (hostKeys.length === 0 && hasUserState()) pushStateToHost();
				// Issue #51: the probe settled with a REAL host answer — consume
				// the deferred wallpaper seed now. Any wallpaper key present in
				// the host state (even null = user-cleared) means the host is
				// authoritative and the factory look must NOT resurrect; absent
				// means no wallpaper decision exists (true first install) — seed
				// the shipped look now, a few hundred ms into the session, so
				// first-install users still get it and dynamic-port restarts
				// never flash it over a durable value.
				let deferredWrote = false;
				if (typeof seedDeferredFactoryWallpaper === "function") {
					try {
						deferredWrote = seedDeferredFactoryWallpaper(
							DEFERRED_WALLPAPER_KEYS.some((k) => Object.prototype.hasOwnProperty.call(parsed.value, k))
						) === true;
					} catch {}
				}
				// Re-run the visual restore when the deferred seed ACTUALLY wrote
				// (adopted is false on a fresh install — nothing was adopted, but
				// the wallpaper just landed and the first paint needs it).
				if ((adopted || deferredWrote) && typeof onHostReady === "function") onHostReady();
			} catch {
				// host unreachable / timed out — keep using localStorage
			} finally {
				// Release the push gate regardless of outcome (adopted / empty /
				// unreachable): user writes after this point push as usual.
				hostProbeSettled = true;
				if (pendingHostSync) {
					pendingHostSync = false;
					scheduleHostSync();
				}
			}
		}

		/** Load the persistent factory provenance snapshot into memory. */
		function loadFactorySnapshot() {
			try {
				const raw = window.localStorage.getItem(FACTORY_SNAPSHOT_KEY);
				const parsed = raw === null ? null : JSON.parse(raw);
				if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
					for (const [key, value] of Object.entries(parsed)) factorySnapshot.set(key, String(value));
				}
			} catch {
				// corrupt / unavailable storage — provenance falls back to empty
			}
		}

		/** Drop one key from the persistent provenance snapshot and persist it. */
		function removeFactoryProvenance(key) {
			if (!factorySnapshot.delete(key)) return;
			saveFactorySnapshot();
		}

		/** Persist the provenance snapshot (best effort; never throws). */
		function saveFactorySnapshot() {
			try {
				const obj = {};
				for (const [key, value] of factorySnapshot) obj[key] = value;
				window.localStorage.setItem(FACTORY_SNAPSHOT_KEY, JSON.stringify(obj));
			} catch {
				// storage unavailable / quota — provenance degrades gracefully
			}
		}

		/**
		 * Whether the given key currently holds a value that traces back to the
		 * factory seeding rather than to the user. Cross-session safe: consults
		 * the PERSISTENT snapshot (value match), falling back to this session's
		 * seal set for writes that have not been snapshotted yet.
		 */
		function isFactorySeededValue(key, value) {
			if (value === null) return false;
			if (factorySnapshot.has(key)) return factorySnapshot.get(key) === value;
			if (factorySealed.has(key)) return true;
			// Snapshot not loaded (or lost): treat an exact current FACTORY_DEFAULT
			// value on a never-user-touched key as factory provenance — a user who
			// manually re-entered the identical shipped value is conservatively
			// treated as factory (harmless: the value is identical by definition).
			if (!writtenKeys.has(key)) {
				const factoryValue = Object.prototype.hasOwnProperty.call(FACTORY_DEFAULTS, key) ? FACTORY_DEFAULTS[key] : undefined;
				if (factoryValue !== undefined && value === factoryValue) return true;
			}
			return false;
		}

		/**
		 * Whether the cache holds ANY user-owned value (blue-team B1/T1): used
		 * to decide if an empty host file should be seeded from local state.
		 * Factory-seeded values — by session seal OR persistent provenance — do
		 * not count, so a same-origin reload after the one-shot seeding (where
		 * no factory write runs and the session seal set is empty) still cannot
		 * bake the shipped look into the host file.
		 */
		function hasUserState() {
			for (const [key, value] of stateCache) {
				if (value === null) continue;
				if (key === FACTORY_APPLIED_KEY || key === FACTORY_SNAPSHOT_KEY) continue;
				if (factorySealed.has(key)) continue;
				if (factorySnapshot.has(key) && factorySnapshot.get(key) === value) continue;
				return true;
			}
			return false;
		}

		/** Read a value (cache first, localStorage seed, null on absence). */
		function readStorage(key) {
			if (stateCache.has(key)) return stateCache.get(key);
			let value = null;
			try {
				value = window.localStorage.getItem(key);
			} catch {
				// storage unavailable
			}
			stateCache.set(key, value);
			return value;
		}

		/** Write (or remove with null) a value: cache + localStorage now, host later. */
		function writeStorage(key, value, opts = {}) {
			stateCache.set(key, value);
			writtenKeys.add(key);
			// Factory seeds are provisional (blue-team B1): tagged so the boot
			// host-probe can outrank them; any later user write unseals the key
			// and clears the persistent provenance (the user owns it now).
			if (opts.factory) {
				factorySealed.add(key);
				// Track provenance durably (blue-team T1): the value must still be
				// recognizable as factory-seeded after a same-origin reload, where
				// the session seal set is gone.
				factorySnapshot.set(key, value);
				saveFactorySnapshot();
			} else {
				factorySealed.delete(key);
				removeFactoryProvenance(key);
			}
			try {
				if (value === null) window.localStorage.removeItem(key);
				else window.localStorage.setItem(key, value);
			} catch {
				// storage unavailable / quota — the cache still holds the value
			}
			// Factory seeding must NEVER schedule a host push (blue-team A1):
			// the shipped look is first-paint sugar, not user config — pushing
			// it would bake it into dream-skin.json (and pendingHostSync would
			// flush it right after the boot probe settles).
			if (opts.factory) return;
			scheduleHostSync();
		}

		/** Saved skin id (may be unknown/absent). */
		function readSavedSkin() {
			return readStorage(STORAGE_KEY);
		}

		/** Whether a known (third-party) skin id is currently saved & not system. */
		function readSavedSkinValid() {
			const saved = readSavedSkin();
			if (typeof saved !== "string" || saved === DEFAULT_SKIN) return false;
			return SKINS.some((skinDefinition) => skinDefinition.id === saved) || importedPacks.some((p) => p.id === saved);
		}

		/** Persist a skin choice; DEFAULT_SKIN clears the stored value. */
		function writeSavedSkin(id) {
			writeStorage(STORAGE_KEY, id === DEFAULT_SKIN ? null : id);
			// Tavern: picking one half of a scheme family is also a scheme choice.
			// Record it, or the next restore would flip back to the other half.
			const skin = SKINS.find((skinDefinition) => skinDefinition.id === id);
			if (typeof skin?.schemeFamily === "string") writeBuiltinLast(skin.colorScheme);
		}

		/** Wallpaper data URL (null when unset). */
		function readWallpaper() {
			const value = readStorage(WALLPAPER_KEY);
			return value !== null && value.length > 0 ? value : null;
		}

		/** Wash opacity 0..1 (clamped; default when unset). */
		function readWallpaperOpacity() {
			const raw = readStorage(WALLPAPER_OPACITY_KEY);
			if (raw === null) return DEFAULT_WALLPAPER_OPACITY;
			const value = Number(raw);
			return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_WALLPAPER_OPACITY;
		}

		/** Blur radius in px (clamped to 0..60; default when unset). */
		function readWallpaperBlur() {
			const raw = readStorage(WALLPAPER_BLUR_KEY);
			if (raw === null) return DEFAULT_WALLPAPER_BLUR;
			const value = Number(raw);
			return Number.isFinite(value) ? Math.min(60, Math.max(0, value)) : DEFAULT_WALLPAPER_BLUR;
		}
		/** Sidebar wash opacity 0..1 (clamped; default when unset). */
		function readSidebarOpacity() {
			const raw = readStorage(SIDEBAR_OPACITY_KEY);
			if (raw === null) return DEFAULT_SIDEBAR_OPACITY;
			const value = Number(raw);
			return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_SIDEBAR_OPACITY;
		}

		/** Whether the sidebar wash opacity is linked to the main canvas (default: no — issue #55). */
		function readSidebarLink() {
			const raw = readStorage(SIDEBAR_LINK_KEY);
			if (raw === null) return DEFAULT_SIDEBAR_LINK !== 0;
			const n = Number(raw);
			return Number.isFinite(n) ? n !== 0 : (DEFAULT_SIDEBAR_LINK !== 0);
		}

		/**
		 * Whether a wallpaper wash is on screen right now. The sidebar fill is
		 * only overridden while one exists (`shadeTokens2()` is what publishes
		 * `--dsw-specific-sidebar-fill`), so this also decides whether the
		 * sidebar-transparency slider can change anything at all (issue #55
		 * review, P1-1/P1-2).
		 */
		function hasWallpaperWash() {
			return wallpaperBackgroundCss() !== null;
		}

		/**
		 * Persist the sidebar wash opacity AND release the canvas link, in the
		 * one order that keeps a drag honest (issue #55). While linked,
		 * `shadeTokens2()` uses the CANVAS alpha and ignores
		 * SIDEBAR_OPACITY_KEY, so storing the value without releasing the link
		 * would persist a number that never reaches a pixel — the "有反馈、无效果"
		 * complaint this issue is about.
		 *
		 * The release is skipped when no wash exists: with no wash on screen the
		 * sidebar fill is not overridden at all, so flipping the user's stored
		 * preference there would change a setting without changing anything
		 * visible. Shared by BOTH slider surfaces (wallpaper row + glass row) so
		 * they cannot drift apart.
		 *
		 * @returns {number} the clamped opacity that was stored.
		 */
		function writeSidebarOpacityForSlider(percent) {
			const value = Math.min(1, Math.max(0, Number(percent) / 100));
			writeStorage(SIDEBAR_OPACITY_KEY, String(value));
			if (hasWallpaperWash() && readSidebarLink()) writeStorage(SIDEBAR_LINK_KEY, "0");
			return value;
		}

		/** Popup / option-card fill opacity 0..1 (clamped; default when unset). */
		function readModalOpacity() {
			const raw = readStorage(MODAL_OPACITY_KEY);
			if (raw === null) return DEFAULT_MODAL_OPACITY;
			const value = Number(raw);
			return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_MODAL_OPACITY;
		}

		/** Persist the popup fill opacity (0..1, clamped) and cache it in-process. */
		function writeModalOpacity(value) {
			const clamped = Math.min(1, Math.max(0, Number(value)));
			writeStorage(MODAL_OPACITY_KEY, String(clamped));
			return clamped;
		}

		/** Composer (chat input) fill opacity 0..1 (clamped; default when unset). */
		function readComposerOpacity() {
			const raw = readStorage(COMPOSER_OPACITY_KEY);
			if (raw === null) return DEFAULT_COMPOSER_OPACITY;
			const value = Number(raw);
			return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_COMPOSER_OPACITY;
		}

		/** Persist the composer fill opacity (0..1, clamped). */
		function writeComposerOpacity(value) {
			const clamped = Math.min(1, Math.max(0, Number(value)));
			writeStorage(COMPOSER_OPACITY_KEY, String(clamped));
			return clamped;
		}

		/**
		 * Apply the persisted composer fill weight onto `:root` as COMPOSER_FILL_VAR.
		 * The injected material CSS mixes the active base color at this percentage
		 * into the composer card fill, so the chat input's translucency (and the
		 * legibility of what you type) becomes user-adjustable.
		 */
		function applyComposerOpacity() {
			const weight = Math.round(readComposerOpacity() * 100);
			try {
				document.documentElement.style.setProperty(COMPOSER_FILL_VAR, `${weight}%`);
				// Round-17: on liquid the slider means glass THICKNESS — more
				// opaque = more backdrop blur (+0..24px). The var is consumed
				// only by the liquid ::before rule, so frosted is unaffected;
				// the text behind stays fogged (real backdrop-filter), and the
				// wallpaper's own blur stacks naturally inside the sample.
				const thickness = Math.round(readComposerOpacity() * 24);
				document.documentElement.style.setProperty(LIQUID_THICKNESS_VAR, `${thickness}px`);
			} catch {
				// document null in a headless eval — the CSS fallback still applies
			}
		}

		/**
		 * Push the live glass blur radius onto `:root` as GLASS_BLUR_VAR.
		 * Round-5: the radius comes from the USER'S 壁纸模糊 slider — the ONE
		 * blur knob for everything (wallpaper layer, composer frost, popup
		 * frost). The material chip only switches the material CHARACTER
		 * (saturation/brightness of the glass); it never owns a blur number,
		 * so switching materials can never move any slider value (user decision:
		 * "切材质不许改数值"). Kept the DEFAULT_GLASS_BLUR fallback for profiles
		 * with no stored blur yet.
		 */
		/**
		 * Round-17: the SVG displacement-refraction experiment is REMOVED.
		 * Chromium does not support `backdrop-filter: url(#…)` (the rule was
		 * silently dropped whole), and the `filter: url()` wallpaper-replica
		 * replacement destroyed `background-attachment: fixed` alignment and
		 * erased the DOM text behind the pane (user screenshots round-16).
		 * Liquid glass now expresses "refraction" the one way Chromium CAN:
		 * backdrop-filter with a per-material blur thickness (round-17 below).
		 */

		function applyMaterialBlur() {
			// Null/empty storage must fall back to DEFAULT — Number(null)===0
			// would otherwise force every glass surface to 0px at boot.
			const rawStr = readStorage(WALLPAPER_BLUR_KEY);
			const raw = rawStr == null || rawStr === "" ? NaN : Number(rawStr);
			const blur = Number.isFinite(raw) ? Math.min(60, Math.max(0, raw)) : DEFAULT_GLASS_BLUR;
			// Tone follows the active material; no glass when unset.
			const preset = MATERIAL_PRESETS.find((p) => p.id === readMaterialPreset()) || MATERIAL_PRESETS[0];
			// Round-10: per-material BLUR scale — liquid is THIN glass (×0.25):
			// heavy blur is what made it read as white frosted glass; refraction
			// needs the backdrop mostly sharp underneath.
			const scale = preset.blurScale != null ? preset.blurScale : 1;
			const scaled = Math.round(blur * scale * 10) / 10;
			try {
				document.documentElement.style.setProperty(GLASS_BLUR_VAR, `${scaled}px`);
				document.documentElement.style.setProperty(GLASS_TONE_VAR, preset.tone || MATERIAL_PRESETS[0].tone);
				// Round-8: the glass FILL color per material (liquid = neutral white,
				// frosted = skin base). Set alongside the tone so the composer glass
				// never reads tea-colored on liquid again.
				document.documentElement.style.setProperty(GLASS_TINT_VAR, preset.tint || MATERIAL_PRESETS[0].tint);
				// Round-9: per-material fill WEIGHT factor (liquid caps the slider
				// weight at 15% so a white fill can never board up the glass).
				document.documentElement.style.setProperty(GLASS_FILL_SCALE_VAR, String(preset.fillScale != null ? preset.fillScale : 1));
				// Material marker (round-7 refraction boost): lets CSS key
				// material-specific refinements (the liquid glass edge highlight)
				// off the active material without extra plumbing.
				document.documentElement.setAttribute("data-dsh-material", preset.id);
			} catch {
				// document null in a headless eval — the CSS fallback still applies
			}
		}

		/** Preserve explicit material choices; unset and legacy defaults disable glass. */
		function readMaterialPreset() {
			const raw = readStorage(MATERIAL_PRESET_KEY);
			return MATERIAL_PRESETS.some((preset) => preset.id === raw) ? raw : DEFAULT_MATERIAL_PRESET;
		}

		/** Persist the glass material preset id. */
		function writeMaterialPreset(id) {
			writeStorage(MATERIAL_PRESET_KEY, MATERIAL_PRESETS.some((preset) => preset.id === id) ? id : null);
		}

		/** Read the last concrete built-in preference (`light`|`dark`|null). */
		function readBuiltinLast() {
			const raw = readStorage(BUILTIN_LAST_KEY);
			return raw === "light" || raw === "dark" ? raw : null;
		}

		/** Persist the last concrete built-in preference (or null to clear it). */
		function writeBuiltinLast(pref) {
			writeStorage(BUILTIN_LAST_KEY, pref === "light" || pref === "dark" ? pref : null);
		}
		//#endregion

		//#region dsh-dream-skin: wallpaper layer + token shading
		/** The fixed backdrop layer (z-index -1), created lazily. */
		let wallpaperEl = null;
		/**
		 * Dynamic packages are assigned one token-override source by the production
		 * client runner, regardless of the source label passed by the package. Keep
		 * every Dream Skin contribution in one layer so wallpaper, popup opacity and
		 * accent do not replace one another there.
		 */
		const COMBINED_OVERRIDE_SOURCE = "dsh-dream-skin:appearance";
		let combinedOverrideDispose = null;
		let combinedOverrideApplying = false;
		let wallpaperTokenOverrides = {};
		let popupTokenOverrides = {};
		let accentTokenOverrides = {};

		/**
		 * Tavern: the native ui-theme.preference (light/dark/system) and the
		 * third-party skin selection share ONE preference slot, so a skin takes the
		 * slot over and the native choice is no longer readable from
		 * snapshot.preference. Recover the scheme the user actually asked for: a
		 * concrete built-in preference answers directly, system resolves through the
		 * built-in active theme, and a skin id falls back to the last concrete
		 * built-in choice this plugin recorded (BUILTIN_LAST_KEY).
		 */
		function nativeScheme(snapshot) {
			const preference = snapshot?.preference;
			if (preference === "light" || preference === "dark") return preference;
			// A remote browser's host preference is process-local and falls back to
			// `system` on every reconnect (lock screen, app resume). That `system` is a
			// reset, not a choice: a recorded concrete scheme (built-in light/dark, or
			// one half of a family picked in the skin picker) must outrank it.
			const recorded = readBuiltinLast();
			if (recorded !== null) return recorded;
			if (preference === "system") {
				const scheme = snapshot?.active?.colorScheme;
				return scheme === "light" || scheme === "dark" ? scheme : null;
			}
			return null;
		}
		/**
		 * Map a skin to the same-family member matching scheme: skins sharing a
		 * schemeFamily are light/dark variants of one look, so the native pointer
		 * can drive which one is active. Returns skinId unchanged when the scheme
		 * is unknown, the skin declares no family, or the family has no member for
		 * that scheme -- unpaired skins and imported packs are never rewritten.
		 */
		function resolveSchemeSkin(skinId, scheme) {
			if (scheme !== "light" && scheme !== "dark") return skinId;
			const self = SKINS.find((skin) => skin.id === skinId);
			if (self === undefined || typeof self.schemeFamily !== "string") return skinId;
			const match = SKINS.find((skin) => skin.schemeFamily === self.schemeFamily && skin.colorScheme === scheme);
			return match === undefined ? skinId : match.id;
		}
		function rawActiveTheme(snapshot) {
			// `preference` is the authoritative selected theme id. In the production
			// dynamic-package event facade, `snapshot.active` can already be the
			// composed presentation object (and has been observed without a usable
			// third-party id). Looking it up by `active.id` then falls through to the
			// composed tokens and feeds our previous wallpaper wash back into the next
			// skin. Prefer the registered definition selected by `preference`; only use
			// active.id for `system`, where it resolves to the concrete light/dark theme.
			const savedId = readSavedSkin();
			const selectedId = typeof savedId === "string" && savedId !== DEFAULT_SKIN
				? savedId
				: snapshot.preference === "system"
				? snapshot.active?.id
				: snapshot.preference;
			const wantedId = resolveSchemeSkin(selectedId, nativeScheme(snapshot));
			return snapshot.themes?.find((theme) => theme.id === wantedId)
				|| snapshot.themes?.find((theme) => theme.id === snapshot.active?.id)
				|| snapshot.active;
		}

		function applyCombinedTokenOverrides(ctx) {
			if (combinedOverrideApplying) return;
			combinedOverrideApplying = true;
			try {
				const overrides = {
					...popupTokenOverrides,
					...accentTokenOverrides,
					...wallpaperTokenOverrides
				};
				if (Object.keys(overrides).length > 0) {
					const previousDispose = combinedOverrideDispose;
					combinedOverrideDispose = ctx.theme.overrideTokens(COMBINED_OVERRIDE_SOURCE, overrides);
					previousDispose?.();
				} else {
					combinedOverrideDispose?.();
					combinedOverrideDispose = null;
				}
			} finally {
				combinedOverrideApplying = false;
			}
		}
		/** The injected liquid-glass <style> node (leaf-card backdrop blur). */
		let materialStyleEl = null;

		/** Parse a hex or rgb()/rgba() color into rgba() with the given alpha. */
		function toRgba(color, alpha) {
			const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
			if (hex !== null) {
				let digits = hex[1];
				if (digits.length === 3) digits = digits.split("").map((char) => char + char).join("");
				const n = parseInt(digits, 16);
				return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
			}
			const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(color.trim());
			if (rgb !== null) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
			return color.trim();
		}

		/**
		 * The base color for one scheme: the active skin's `--dsw-alias-bg-base`
		 * when it owns that scheme, otherwise the built-in base. The wash always
		 * carries the active skin's tint (and re-shades on theme/change).
		 */
		function resolveBase(scheme, active) {
			if (active.colorScheme === scheme && typeof active.tokens["--dsw-alias-bg-base"] === "string") {
				return active.tokens["--dsw-alias-bg-base"];
			}
			return BUILTIN_BASE[scheme];
		}
		function resolveSidebar(scheme, active) {
			if (active.colorScheme === scheme && typeof active.tokens["--dsw-specific-sidebar-fill"] === "string") {
				return active.tokens["--dsw-specific-sidebar-fill"];
			}
			return resolveBase(scheme, active);
		}

		/** Remove the wallpaper layer and its token contribution. */
		function teardownWallpaper(ctx = null) {
			wallpaperEl?.remove();
			wallpaperEl = null;
			wallpaperTokenOverrides = {};
			if (ctx !== null) applyCombinedTokenOverrides(ctx);
		}

		//#region dsh-dream-skin: liquid-glass material CSS
		/**
		 * Ingest a self-contained <style> that gives DSH's leaf "cards" a premium
		 * liquid-glass material: a semi-translucent fill (set per-skin via
		 * `--dsw-specific-input-major`) combined with `backdrop-filter: blur()`
		 * so the diffused-glow wallpaper frosts through. Two safety rules, learned
		 * from the earlier regression:
		 *   1. We only target LEAF cards that do NOT host a `position:fixed`
		 *      descendant. `backdrop-filter` (like `filter`/`transform`) turns
		 *      the element into a containing block, so a fixed-positioned child
		 *      is laid out relative to the card instead of the viewport. The
		 *      composer card (`.uV2eYG_card`) deliberately carries the stop /
		 *      send button Tooltips — fixed popovers — and blurring it made
		 *      them anchor to the card and spill to the bottom-right corner,
		 *      shoving the composer out of layout. So the material blur applies
		 *      to the inline-warning card (`.bqrRRG_card`) and the todo
		 *      popover/dock (`.lXshSW_root`, `._7yHdaG_panel`) but NOT to the
		 *      composer card; the composer keeps its translucent token fill.
		 *      (The earlier bug was blurring LARGE columns that contained the
		 *      fixed settings modal.)
		 *   2. `@supports` guards browsers without backdrop-filter; if a hashed
		 *      class name changes in a future DSH the selectors no-op (blur just
		 *      stops) without ever breaking layout.
		 * The settings modal is NOT blurred here — it already carries DSH's own
		 * mask blur and a high-opacity layer-2 fill so it stays readable.
		 */
		const MATERIAL_CSS_SOURCE = "dsh-dream-skin:material:liquid-glass";
		// Issue #50 (user on dsh 0.1.5-rc.2): every host hash class in MATERIAL_CSS
		// (`uV2eYG_card`, `Mbwy4a_card`, …) had been re-rolled away by the time
		// 0.1.5 shipped — the composer glass rules matched NOTHING, so the
		// 输入框透明度 slider moved a var no rule consumed. Hashes can never be a
		// stable contract, so the glass rules now ALSO match our own attribute,
		// and JS marks the composer card by DOM shape (textarea anchor → nearest
		// rounded ancestor) instead of by class name. Old hosts keep working via
		// the hashes; on them the marker preferentially tags the SAME element the
		// hash rules hit, so the two selector families never double-paint.
		const COMPOSER_CARD_ATTR = "data-dsh-dream-skin-composer";
		// Adversarial-review F6: only TRUE composer cards belong here. The user
		// question option card (`.Mbwy4a_card`) was mistakenly listed before —
		// its 1939 opaque no-bleed fill is a DELIBERATE readability fix, and any
		// [attr] glass rule that lands on it later in the sheet would punch a
		// transparent hole through that design. It must never be tagged.
		const COMPOSER_HASH_CARDS = ".uV2eYG_card";
		// Issue #50 round 3: on dsh 0.1.5-rc.2 (also what dsh-desktop pins) the
		// chat input is NOT a <textarea> at all — it is a Lexical contenteditable
		// div rendered with a stable data attribute (`data-composer-input`,
		// verified in @deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.2). The
		// textarea-only anchor therefore never matched on those hosts and the
		// slider stayed dead regardless of retries. Anchor on the fingerprint
		// FIRST, then fall back to a plain textarea and a generic editable
		// textbox for other host generations.
		const COMPOSER_ANCHOR_SELECTOR = "[data-composer-input], textarea, [contenteditable='true'][role='textbox']";
		function isInDialog(el) {
			try { return el.closest('[role="dialog"]') !== null; } catch { return false; }
		}
		function findVisibleComposerAnchors() {
			if (typeof document.querySelectorAll !== "function") return [];
			try {
				const out = [];
				const list = document.querySelectorAll(COMPOSER_ANCHOR_SELECTOR);
				for (const el of list) {
					if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
					// Adversarial-review F1: the generic fallbacks (textarea /
					// contenteditable) would otherwise adopt ANY visible editable
					// element — e.g. an input inside a settings dialog — and the
					// glass rules would strip that surface's background. The chat
					// composer never lives inside a dialog, so exclude that subtree.
					if (isInDialog(el)) continue;
					out.push(el);
				}
				return out;
			} catch { return []; }
		}
		function nearestComposerCard(anchor) {
			let card = null;
			try { card = anchor.closest(COMPOSER_HASH_CARDS); } catch {}
			if (card !== null) return card;
			// Hashes gone (new host): climb to the nearest visibly rounded
			// ancestor — the composer card is the only rounded pane around
			// the chat input. Pass 1 wants a clear round (>=8px); pass 2
			// relaxes to >=4px for hosts that wrap the input in a flatter
			// card (dsh-desktop frame chrome).
			for (const min of [8, 4]) {
				let node = anchor.parentElement;
				for (let hops = 0; node !== null && hops < 6; hops += 1, node = node.parentElement) {
					let radius = 0;
					try {
						if (typeof getComputedStyle === "function") {
							// Adversarial-review F3: CSSOM reports percentage radii
							// verbatim ("50%"), and parseFloat would read that as
							// 50px — a pill-shaped ancestor would pass the ≥8px
							// gate. Percentage radii are decorative, reject them.
							const raw = String(getComputedStyle(node).borderTopLeftRadius || "");
							radius = raw.indexOf("%") !== -1 ? 0 : (parseFloat(raw) || 0);
						}
					} catch {}
					if (radius >= min) {
						// F3: first-hit-wins could adopt a huge rounded container
						// (sidebar pane, message column). The composer card hugs
						// the input's width — reject anything far wider.
						try {
							if (anchor.offsetWidth > 0 && node.offsetWidth > anchor.offsetWidth * 3) continue;
						} catch {}
						return node;
					}
				}
			}
			return null;
		}
		function markComposerCards() {
			try {
				const anchors = findVisibleComposerAnchors();
				let changed = false;
				for (const anchor of anchors) {
					const card = nearestComposerCard(anchor);
					if (card === null) continue;
					if (card.getAttribute(COMPOSER_CARD_ATTR) !== "1") {
						card.setAttribute(COMPOSER_CARD_ATTR, "1");
						changed = true;
					}
				}
				return changed;
			} catch { return false; }
		}
		let composerMarkerStarted = false;
		let composerMarkerDispose = null;
		function startComposerMarker() {
			if (composerMarkerStarted) return composerMarkerDispose;
			composerMarkerStarted = true;
			let marked = false;
			const run = () => { try { if (markComposerCards()) marked = true; } catch {} };
			run();
			const timers = [];
			// dsh-desktop mounts the conversation much later than the web host
			// (issue #50 follow-up): the first paint often has no textarea yet,
			// so a single mark-on-boot pass misses it. Poll cheaply until the
			// first successful mark, on top of the MutationObserver (which also
			// keeps re-marking after SPA re-renders discard the attribute).
			// Adversarial-review F4: the poll's job is to establish the FIRST
			// mark; stop as soon as anything is tagged (marked latches true and
			// is never reset) instead of idling out the full 30 tries.
			if (!marked && typeof setInterval === "function" && typeof clearInterval === "function") {
				let tries = 0;
				const timer = setInterval(() => {
					run();
					tries += 1;
					if (marked || tries > 30) { try { clearInterval(timer); } catch {} }
				}, 800);
				timers.push(timer);
			}
			if (typeof MutationObserver === "function") {
				try {
					let scheduled = false;
					const tick = () => { scheduled = false; run(); };
					// Adversarial-review F5: chat streaming mutates the DOM many
					// times a second; re-scanning on every mutation forces layout
					// (offsetWidth in the anchor filter) for no benefit. Only wake
					// when nodes were ADDED (a re-render that could carry a fresh,
					// untagged composer) — attribute tweaks and text streaming
					// cannot produce a new input.
					const mo = new MutationObserver((records) => {
						if (scheduled) return;
						let relevant = false;
						for (const r of records) {
							if (r.type === "childList" && r.addedNodes.length > 0) { relevant = true; break; }
						}
						if (!relevant) return;
						scheduled = true;
						if (typeof requestAnimationFrame === "function") {
							try { requestAnimationFrame(tick); } catch { setTimeout(tick, 100); }
						} else {
							setTimeout(tick, 100);
						}
					});
					// Observe documentElement, NOT body: the client bundle can be
					// injected before <body> parses (IIFE guard note at EOF), so
					// observing body throws there and the marker silently dies.
					mo.observe(document.documentElement, { childList: true, subtree: true });
					// Adversarial-review F4: the marker outlives the boot path —
					// hand back a teardown so the unload effect can stop polling
					// and disconnect the observer instead of leaking them.
					composerMarkerDispose = () => {
						for (const t of timers) { try { clearInterval(t); } catch {} }
						try { mo.disconnect(); } catch {}
					};
				} catch {}
			}
			return composerMarkerDispose;
		}
		function ensureMaterialStyle() {
			if (materialStyleEl !== null && document.head.contains(materialStyleEl)) return materialStyleEl;
			const parts = [
				"@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {",
				"  .bqrRRG_card {",
				"    -webkit-backdrop-filter: blur(24px) saturate(150%);",
				"    backdrop-filter: blur(24px) saturate(150%);",
				"  }",
				"  .lXshSW_root, ._7yHdaG_panel {",
				"    -webkit-backdrop-filter: blur(20px) saturate(140%);",
				"    backdrop-filter: blur(20px) saturate(140%);",
				"  }",
				"}",
				// A second rule (always applied, not @supports-gated) used to give the
				// composer root a bottom-scrim so a scrolled-up message / "turn N"
				// monitor row never shows through under the input. That scrim was a
				// full-rectangle gradient over the WIDER `.uV2eYG_root` (which is
				// wider than the rounded `.uV2eYG_card`), so on skins with a
				// wallpaper it painted a big sharp-cornered rectangle behind and
				// around the rounded input — the "外层尖角框" users disliked. The
				// composer card already carries its own translucent glass fill +
				// backdrop blur, so the frame is dropped: the root is now fully
				// transparent and only the rounded card reads. Readability is kept
				// by the card's own fill; nothing sharp frames the input anymore.
				".uV2eYG_root, [" + COMPOSER_CARD_ATTR + "] {",
				"  background: transparent;",
				"}",
				// --- Right file panel consistency (issue: left rail vs right panel) ---
				// The left sidebar reads the skin's `--dsw-specific-sidebar-fill`
				// (a translucent dark tint that matches the wallpaper wash), but the
				// right file panel (`nArs4W_panel`) fell back to DSH's default
				// near-white translucent fill, so the two halves rendered with
				// totally different tints. Give the right panel the very same
				// sidebar fill and a matching hairline so both sides look uniform.
				".nArs4W_panel {",
				"  background: var(--dsw-specific-sidebar-fill) !important;",
				"  border-left-color: var(--dsw-alias-border-l2);",
				"}",
				// The white default show-through can leak on nested panes that carry
				// their own translucent white; force them to inherit the sidebar fill.
				".nArs4W_pane, .nArs4W_paneContent, .nArs4W_workbench, .nArs4W_explorerBody {",
				"  background: transparent;",
				"}",
				// The `--dsw-specific-menu` / `--dsw-alias-bg-overlay` surfaces are now
				// driven by the popup-opacity override layer (applyModalOverlay) so the
				// user-adjustable「弹窗不透明度」slider actually tunes menu / popover /
				// dialog translucency — left per-skin otherwise.
				// --- Left sidebar foot/settings consistency (issue: settings area) ---
				// The workspace list region (`hHd-Xa_regionArea`) overhangs to the
				// column's left/right edges (margin-left:-4px / margin-right:-12px),
				// but the footer/settings region was a plain `width:100%` box stuck
				// at the inner padding, so it sat ~4px inset left and ~12px inset
				// right. At the seam between the scrolling list and the footer that
				// difference made a visible vertical step that read as a "断裂" —
				// the two planes looked misaligned/detached. Align the footer to the
				// exact same span as the list so the whole left column is one
				// continuous plane.
				".hHd-Xa_root .hHd-Xa_footArea, .hHd-Xa_root .hHd-Xa_settingsArea, .hHd-Xa_root .hHd-Xa_footerActions {",
				"  width: auto;",
				"  margin-right: calc(-1 * var(--dsh-sidebar-inline-padding, 12px));",
				"  margin-left: -4px;",
				"  padding-right: var(--dsh-sidebar-inline-padding, 12px);",
				"  padding-left: 4px;",
				"}",
				// Force a single uniform fill across the whole sidebar and remove any
				// leftover erase-band / divider right at the list-footer boundary.
				".hHd-Xa_footArea, .hHd-Xa_settingsArea, .hHd-Xa_footerActions {",
				"  background: transparent;",
				"  box-shadow: none;",
				"  border: none;",
				"}",
				// The conversation list ends with a fade (`.qDHVXG_fade`) so the whole
				// left column fades uniformly into the sidebar fill — no seam at the
				// foot.
				".qDHVXG_fade {",
				"  background: transparent;",
				"}",
				// The user-questions option card (`.Mbwy4a_card`) shares `--dsw-specific-input-major`
				// with the composer, which is intentionally very translucent for the liquid-glass
				// input. On its own that makes the option modal illegible (background text bleeds
				// through). Override it with a high-opacity fill derived from the active base color,
				// so the options stay readable in BOTH deep and light skins while still carrying a
				// subtle glass blur. This is a leaf card, so backdrop-filter here is safe.
				//
				// The fill weight (what % of the base color the block carries) is user-adjustable
				// via Settings → 外观 → 弹窗不透明度, held in the MODAL_FILL_VAR custom property.
				// Lower weight = more transparent (content shows through); higher = nearly solid.
				// The plain token line first is a deliberate fallback for webviews without
				// color-mix(): they drop only the color-mix declaration and keep an opaque
				// token fill, so the popup slider degrades instead of leaving the card
				// transparent with text bleeding through.
				".Mbwy4a_card {",
				"  background: var(--dsw-alias-bg-overlay);",
				"  background: color-mix(in srgb, var(--dsw-alias-bg-base) var(" + MODAL_FILL_VAR + ", 94%), transparent);",
				// Same ONE blur knob as the composer ::before — every glass surface
				// moves in lock step (user review round 2, 举一反三). Tone tail
				// comes from the material chip (GLASS_TONE_VAR, round 5).
				"  -webkit-backdrop-filter: blur(var(" + GLASS_BLUR_VAR + ", " + DEFAULT_GLASS_BLUR + "px)) var(" + GLASS_TONE_VAR + ", " + MATERIAL_PRESETS[0].tone + ");",
				"  backdrop-filter: blur(var(" + GLASS_BLUR_VAR + ", " + DEFAULT_GLASS_BLUR + "px)) var(" + GLASS_TONE_VAR + ", " + MATERIAL_PRESETS[0].tone + ");",
				"}",
				// --- Composer (chat input) glass: REAL frosted glass via a ::before
				// isolation layer (catppuccin's technique). The old approach only
				// tinted the card fill — the wallpaper bled straight through and the
				// slider looked like "color got a bit darker", never like glass.
				// The pseudo-element is NOT an ancestor of the card's content, so
				// its backdrop-filter blurs the backdrop behind the input WITHOUT
				// becoming the containing block for the fixed-positioned stop/send
				// Tooltips (the reason blur was forbidden on this card before) —
				// they keep the viewport containing block and are never trapped.
				// isolation:isolate makes the CARD a stacking context so the
				// z-index:-1 ::before paints BETWEEN the card's own background and
				// its content — without it a negative-z child slides UNDER the
				// card background (opaque on ivory/rose skins) and the glass would
				// be invisible there (blue-team D2).
				// User review round 3: the card's own opaque token background sat
				// UNDER the glass layer and blocked the wallpaper entirely — the
				// glass then only tinted that flat token color, so the fill slider
				// looked like "slightly darker/lighter gray" and never changed the
				// see-through. Inside @supports (where the ::before recipe is
				// guaranteed to render) the card body goes TRANSPARENT so the glass
				// layer faces the wallpaper directly; unsupported webviews keep the
				// token fill as the whole fallback.
				// Recipe (wallpaper-engine's chain): blur from the material knob +
				// saturate to keep the glass alive + brightness lift for the frost.
				// The fill sits on the pseudo too, so fill + blur move together.
				// Fallback FIRST (token fill — keeps no-color-mix webviews legible),
				// then the @supports block transparents the card body where the
				// ::before glass recipe is guaranteed to render. The gate requires
				// BOTH color-mix AND backdrop-filter (blue-team B7): a webview with
				// color-mix but blur force-disabled would otherwise get a transparent
				// card with no frost — near-naked input on the wallpaper.
				// Issue #50: every selector below matches EITHER the legacy hash
				// class (old hosts) OR our own DOM-shape attribute (hosts ≥0.1.5,
				// where the hashes were re-rolled) — see markComposerCard().
				".uV2eYG_card, [" + COMPOSER_CARD_ATTR + "] {",
				"  background: var(--dsw-specific-input-major);",
				"  position: relative;",
				"  isolation: isolate;",
				"}",
				"@supports ((background: color-mix(in srgb, red 50%, transparent)) and (backdrop-filter: blur(1px))) {",
				"  .uV2eYG_card,",
				"  [" + COMPOSER_CARD_ATTR + "] {",
				"    background: transparent;",
				"  }",
				"}",
				".uV2eYG_card::before,",
				"[" + COMPOSER_CARD_ATTR + "]::before {",
				"  content: '';",
				"  position: absolute;",
				"  inset: 0;",
				"  border-radius: inherit;",
				// Fill from the OPAQUE composer-base token (NOT the alpha-washed
				// --dsw-alias-bg-base) so the fill weight is the composer slider's
				// alone and the wallpaper slider can't thin it behind the user's
				// back (blue-team B1). The washed token stays as the fallback for
				// hosts that don't set the opaque one.
				// Fill weight = slider% × material fillScale (round-9): the liquid
				// material scales the user's slider down (×0.15) so even "0%
				// transparency" stays a translucent pane — the white READ comes
				// from the tone + sheen layer below, never from a board of fill.
				"  background: color-mix(in srgb, var(" + GLASS_TINT_VAR + ", var(--dsh-dream-skin-composer-base, var(--dsw-alias-bg-base))) calc(var(" + COMPOSER_FILL_VAR + ", 85%) * var(" + GLASS_FILL_SCALE_VAR + ", 1)), transparent);",
				"  -webkit-backdrop-filter: blur(var(" + GLASS_BLUR_VAR + ", " + DEFAULT_GLASS_BLUR + "px)) var(" + GLASS_TONE_VAR + ", " + MATERIAL_PRESETS[0].tone + ");",
				"  backdrop-filter: blur(var(" + GLASS_BLUR_VAR + ", " + DEFAULT_GLASS_BLUR + "px)) var(" + GLASS_TONE_VAR + ", " + MATERIAL_PRESETS[0].tone + ");",
				"  z-index: -1;",
				"  pointer-events: none;",
				"}",
				// Liquid-glass edge catch light (round-7, tuned round-8 per user:
				// "太重了" — thinner, lighter, fainter). A hairline rim now:
				// 0.5px-ish via low-alpha 1px + barely-there top/bottom accents.
				'html[data-dsh-material="liquid"] .uV2eYG_card::before,',
				'html[data-dsh-material="liquid"] [' + COMPOSER_CARD_ATTR + ']::before {',
				"  box-shadow:",
				"    inset 0 0 0 1px rgba(255,255,255,0.14),",
				"    inset 0 1px 0 0 rgba(255,255,255,0.18),",
				"    inset 0 -1px 0 0 rgba(255,255,255,0.08);",
				"}",
				// Sheen layer (round-9, halved again round-14): the user still read
				// the pane as "too white" — the sweep is now a bare glint (0.10
				// peak); the glass read must come from the refraction, not light.
				'html[data-dsh-material="liquid"] .uV2eYG_card::after,',
				'html[data-dsh-material="liquid"] [' + COMPOSER_CARD_ATTR + ']::after {',
				"  content: '';",
				"  position: absolute;",
				"  inset: 0;",
				"  border-radius: inherit;",
				"  pointer-events: none;",
				"  background: linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.01) 55%, rgba(255,255,255,0.04) 100%);",
				"  mix-blend-mode: screen;",
				"}",
				// Round-17 (user screenshots round-16): the wallpaper-replica +
				// filter:url() experiment is REMOVED — it erased the DOM text
				// behind the pane (a replica can only paint the wallpaper, not
				// the chat flowing under it) and broke background-attachment:
				// fixed alignment (element filter kills fixed attachment).
				// Liquid glass is real backdrop-filter again: the text behind
				// shows through FOGGED (never erased), and the wallpaper's own
				// blur is part of the sampled backdrop, so the two blurs stack
				// naturally. "Refraction" reads as glass THICKNESS: the composer
				// slider adds blur on top of the thin base (0px at max
				// transparency → +24px at max opacity). GLASS_BLUR_VAR arrives
				// ALREADY material-scaled (applyMaterialBlur ×0.25 on liquid,
				// blue-team B3: this rule must not halve it again).
				'html[data-dsh-material="liquid"] .uV2eYG_card::before,',
				'html[data-dsh-material="liquid"] [' + COMPOSER_CARD_ATTR + ']::before {',
				"  -webkit-backdrop-filter: blur(calc(var(" + GLASS_BLUR_VAR + ", " + DEFAULT_GLASS_BLUR + "px) + var(" + LIQUID_THICKNESS_VAR + ", 20px))) saturate(1.8) contrast(1.04) brightness(1.02);",
				"  backdrop-filter: blur(calc(var(" + GLASS_BLUR_VAR + ", " + DEFAULT_GLASS_BLUR + "px) + var(" + LIQUID_THICKNESS_VAR + ", 20px))) saturate(1.8) contrast(1.04) brightness(1.02);",
				"}",
				'html[data-dsh-material="liquid"] .Mbwy4a_card,',
				'html[data-dsh-material="liquid"] [' + COMPOSER_CARD_ATTR + '] {',
				// F5 (round-7 review): outline instead of box-shadow — a shadow rule
				// here would REPLACE whatever elevation shadow the host puts on this
				// card; outline overlays without touching it. Round-8: lighter.
				"  outline: 1px solid rgba(255,255,255,0.12);",
				"  outline-offset: -1px;",
				"}",
				// --- DSH Desktop: the shell shadows the sidebar fill token (issue #55) ---
				// In the Electron shell the upstream sidebar is rendered inside the
				// shell's own <aside class="dshDesktopSidebarSurface">, and that
				// element re-declares `--dsw-specific-sidebar-fill` on itself. A
				// custom property declared on an element shadows every :root / body
				// theme override for the WHOLE subtree, so the sidebar root's own
				// `background: var(--dsw-specific-sidebar-fill)` never saw the wash
				// we compute from the 侧边栏透明度 slider — dragging it moved
				// nothing, while the right file panel (outside that <aside>) kept
				// responding: the two halves visibly disagreed.
				//
				// VERIFIED IN UPSTREAM 2.0.0 (npm, lib/client.js:248): the
				// declaration is `--dsw-specific-sidebar-fill: transparent;`, it is
				// the ONLY declaration of that token in the package, and it uses a
				// plain (non-important) class selector. The issue #55 reporter, on a
				// 2.0.10 build that is NOT published to npm, additionally sees a
				// variant that branches on the window material —
				// `var(--dsw-alias-bg-layer-1)` when it is off (the Windows
				// default). That variant could not be re-verified from source here;
				// both variants are non-important, which is all this rule relies on.
				//
				// `inherit` restores the inherited value for that subtree: the
				// shell's own theme presenter publishes the composed token set
				// (INCLUDING this plugin's overrideTokens layer) on the ancestors,
				// so the wash reaches the sidebar again. `!important` is what makes
				// it win: the shell's declaration is not important, and an
				// important declaration outranks a normal one regardless of
				// selector specificity. (The reporter's 2.0.10 variant uses a MORE
				// specific selector, which changes nothing while it stays
				// non-important.) If the shell ever marks its own declaration
				// important, the clean fix is on the shell side — it should use its
				// own private token instead of the shared skin token — not a
				// specificity war in here.
				//
				// SCOPE AND TRADE-OFF, stated plainly: this makes the skin own the
				// desktop sidebar's fill, exactly as it already does on plain DSH
				// Web. That includes the no-wallpaper case (the sidebar then paints
				// the skin's own sidebar token instead of the shell's transparent
				// frame fill), and it only applies where the shell actually renders
				// that <aside> — the shell mounts this frame in its "advanced"
				// mode, so other modes are untouched. Inert on plain DSH Web:
				// nothing carries .dshDesktopSidebarSurface there.
				DESKTOP_SIDEBAR_SELECTOR + " {",
				"  --dsw-specific-sidebar-fill: inherit !important;",
				"}"
			];
            parts.push('html[data-dsh-material="none"], html[data-dsh-material="none"] *, html[data-dsh-material="none"] *::before, html[data-dsh-material="none"] *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }');
            // DSH 0.2 menus paint a see-through fill meant to sit on that blur; with the blur
            // gone the page shows through the menu, so give them the opaque menu colour.
            parts.push('html[data-dsh-material="none"] body { --dsw-menu-surface-fill: var(--dsw-specific-menu, var(--dsw-alias-bg-base)); }');
			const el = document.createElement("style");
			el.id = MATERIAL_CSS_SOURCE;
			el.textContent = parts.join("\n");
			(document.head || document.body).appendChild(el);
			materialStyleEl = el;
			warnOnMaterialSelectorDrift();
			return el;
		}

		/**
		 * Host class names in MATERIAL_CSS are BUILD HASHES that DSH re-rolls on
		 * release, so a subset of them inevitably stops matching (blue-team R15:
		 * three of eight were already dead on the host this was reviewed against,
		 * while every test stayed green — the old test only checked that the CSS
		 * *string* contains the names). Rule sets are harmless when their selector
		 * no longer matches, so this cannot break anyone; but a silent no-op hides
		 * a real visual regression. Verify each selector against the live DOM once
		 * per mount and warn — turning "silently broken" into "visibly degraded".
		 *
		 * A fresh probe also guards the dangerous half of the drift: if a hash is
		 * reused by a DIFFERENT component in a future build, a rule meant for one
		 * surface would repaint another (possibly a third-party plugin's panel).
		 */
		/**
		 * The desktop shell's sidebar wrapper class (issue #55). This is a
		 * THIRD-PARTY class, not a DSH host hash — it only exists under a desktop
		 * shell, which is why its drift probe is gated (see below).
		 */
		const DESKTOP_SIDEBAR_SELECTOR = ".dshDesktopSidebarSurface";
		/**
		 * Whether a third-party desktop shell is driving this page. Reads the
		 * shell's documented stamps only: `data-dsh-desktop-mode` on <body>, the
		 * preload marker, or the render-URL parameter — the same contract other
		 * plugins (e.g. dsh-better-sidebar) rely on. Never throws.
		 */
		function isDesktopShell() {
			try {
				if (typeof document !== "undefined" && document.body
					&& typeof document.body.getAttribute === "function"
					&& document.body.getAttribute("data-dsh-desktop-mode") !== null) return true;
				if (typeof window !== "undefined" && window.__DSH_DESKTOP_FILE_PATH__ !== undefined) return true;
				const search = typeof location !== "undefined" && typeof location.search === "string" ? location.search : "";
				return /[?&]dsh-desktop-mode=/.test(search);
			} catch {
				return false;
			}
		}
		const MATERIAL_SELECTOR_PROBES = [
			".bqrRRG_card",
			".lXshSW_root, ._7yHdaG_panel",
			// T1 (adversarial review): probes must test ONLY the host hash — the
			// dual-selector rules match our own attribute too, so including it
			// here would let the marker's own tag satisfy the probe and silently
			// green-light a host whose hashes have all drifted away.
			".uV2eYG_root",
			".nArs4W_panel, .nArs4W_pane, .nArs4W_paneContent, .nArs4W_workbench, .nArs4W_explorerBody",
			".hHd-Xa_root .hHd-Xa_footArea, .hHd-Xa_root .hHd-Xa_settingsArea, .hHd-Xa_root .hHd-Xa_footerActions",
			".qDHVXG_fade"
		];
		function warnOnMaterialSelectorDrift() {
			// Frame 1 may not have painted the workbench/settings surfaces yet, so
			// defer one frame; keep it cheap and fully guarded.
			if (typeof document.querySelector !== "function") return;
			const check = () => {
				try {
					const missed = MATERIAL_SELECTOR_PROBES.filter((sel) => {
						try { return document.querySelector(sel) === null; } catch { return true; }
					});
					// The desktop-shell rule (issue #55) gets its OWN gate. Its
					// `.dshDesktopSidebarSurface` is a third-party class, not a host
					// hash: it only ever exists under a desktop shell, so probing it
					// on plain DSH Web would be a permanent false alarm. The gate
					// must be the HOST's own signal (`data-dsh-desktop-mode`, the
					// documented shell contract) rather than the shell's frame class —
					// gating on that class would make the probe unable to ever fire,
					// because a rename removes the gate and the target together.
					if (isDesktopShell() && document.querySelector(DESKTOP_SIDEBAR_SELECTOR) === null) {
						missed.push(DESKTOP_SIDEBAR_SELECTOR + " (desktop shell sidebar surface)");
					}
					if (missed.length > 0) {
						console.warn(
							"[dsh-dream-skin] host class names drifted — these material refinements are inactive on this DSH build (harmless, cosmetic only):",
							missed.join(" | ")
						);
					}
				} catch {}
			};
			if (typeof requestAnimationFrame === "function") {
				try { requestAnimationFrame(check); return; } catch {}
			}
			check();
		}
		/** Remove the injected liquid-glass <style> node on fiber unload. */
		function teardownMaterial() {
			materialStyleEl?.remove();
			materialStyleEl = null;
		}

		/**
		 * Apply the persisted popup-fill weight onto `:root` as MODAL_FILL_VAR, so
		 * every injected rule that references it (the user-options card fill) stays
		 * in sync without rebuilding the stylesheet. The weight is the base-color
		 * percentage (0..100): higher = more opaque/solid, lower = more transparent.
		 * Called at boot (so a saved value re-applies) and whenever the slider moves.
		 */
		function applyModalOpacity() {
			const weight = Math.round(readModalOpacity() * 100);
			try {
				document.documentElement.style.setProperty(MODAL_FILL_VAR, `${weight}%`);
			} catch {
				// document null in a headless eval — the CSS fallback (94%) still applies
			}
		}

		/**
		 * Driver for DSH's elevated popup surfaces. The reporter found the slider
		 * "did nothing": it only ever affected the narrow `.Mbwy4a_card` rule. Real
		 * popups / dropdown menus / dialogs consume DSH's semantic tokens
		 * `--dsw-alias-bg-overlay` ("overlay and popover background") and
		 * `--dsw-specific-menu` (dropdown / popup menus). We stack an override layer
		 * that scales those two surfaces to the ACTIVE base color at the slider's
		 * alpha, so 0% = fully see-through and 100% = solid — a real, visible change.
		 * Pure token override (no backdrop-filter), so it cannot re-trigger the
		 * fixed-modal containing-block bug. Called at boot and on every slider move.
		 */
		const POPUP_TOKENS = ["--dsw-alias-bg-overlay", "--dsw-specific-menu"];
		function applyModalOverlay(ctx) {
			const alpha = readModalOpacity();
			const current = ctx.theme.getTheme();
			const active = rawActiveTheme(current);
			const baseFor = (scheme) => {
				if (active && active.colorScheme === scheme && typeof active.tokens["--dsw-alias-bg-base"] === "string") {
					return active.tokens["--dsw-alias-bg-base"];
				}
				return BUILTIN_BASE[scheme];
			};
			const overrides = {};
			for (const name of POPUP_TOKENS) {
				overrides[name] = {
					light: toRgba(baseFor("light"), alpha),
					dark: toRgba(baseFor("dark"), alpha)
				};
			}
			popupTokenOverrides = overrides;
			applyCombinedTokenOverrides(ctx);
		}
		//#endregion

		//#region dsh-dream-skin: image compression
		/**
		 * Downscale an image onto a canvas and return a JPEG data URL, so a
		 * wallpaper stays well inside the localStorage quota (≤ ~2MB).
		 */
		function compressImage(image, maxSide, quality) {
			const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(image.width * scale));
			canvas.height = Math.max(1, Math.round(image.height * scale));
			const context = canvas.getContext("2d");
			context.drawImage(image, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL("image/jpeg", quality);
		}

		/** Read a picked file into a compressed data URL (null on failure). */
		function readImageAsDataUrl(file, onDone) {
			const reader = new FileReader();
			reader.onerror = () => onDone(null);
			reader.onload = () => {
				const image = new Image();
				image.onerror = () => onDone(null);
				image.onload = () => {
					try {
						let dataUrl = compressImage(image, 1600, 0.75);
						if (dataUrl.length > 2000000) dataUrl = compressImage(image, 1000, 0.6);
						if (dataUrl.length > 2000000) dataUrl = compressImage(image, 800, 0.5);
						onDone(dataUrl);
					} catch {
						onDone(null);
					}
				};
				image.src = reader.result;
			};
			reader.readAsDataURL(file);
		}
		//#endregion

		//#region dsh-dream-skin: settings row stores
		/**
		 * Skin row slot store: a mirror of the theme service snapshot. The
		 * plugin's apply-world change listener is the only writer; the row
		 * component reads via props.useStore.
		 */
		function createSkinStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({
					skin: "system",
					revision: -1
				}),
				actions: {
					sync: (d, skin, revision) => {
						if (revision <= d.revision) return;
						d.skin = skin;
						d.revision = revision;
					}
				}
			});
		}

		/** Wallpaper row store: url + opacity + blur, written only by this plugin. */
		function createWallpaperStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({
					url: null,
					opacity: DEFAULT_WALLPAPER_OPACITY,
					blur: DEFAULT_WALLPAPER_BLUR,
					sidebarOpacity: DEFAULT_SIDEBAR_OPACITY,
					history: [],
					revision: -1
				}),
				actions: {
					sync: (d, url, opacity, blur, sidebarOpacity, history, revision) => {
						if (revision <= d.revision) return;
						d.url = url;
						d.opacity = opacity;
						d.blur = blur;
						d.sidebarOpacity = sidebarOpacity;
						d.history = history;
						d.revision = revision;
					}
				}
			});
		}
		//#endregion

		//#region dsh-dream-skin: settings rows
		/** Inline style sheet for the rows (kept dependency-free). */
		const styles = {
			group: {
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				padding: "16px 0"
			},
			section: {
				display: "flex",
				flexDirection: "column",
				width: "100%"
			},
			title: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: "14px",
				fontWeight: 400,
				lineHeight: "22px"
			},
			hint: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: "12px",
				lineHeight: "18px"
			},
			grid: {
				display: "flex",
				flexWrap: "wrap",
				gap: "10px"
			},
			card: {
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "6px",
				width: "96px",
				padding: "3px",
				borderRadius: "10px",
				background: "transparent",
				border: "none",
				cursor: "pointer",
				font: "inherit",
				boxSizing: "border-box",
				position: "relative",
				outline: "none"
			},
			cardSelected: {
				boxShadow: "0 0 0 2px var(--dsw-alias-brand-primary)",
				background: "rgba(127, 127, 127, 0.10)"
			},
			cardCheck: {
				position: "absolute",
				top: "-4px",
				right: "-4px",
				width: "18px",
				height: "18px",
				borderRadius: "50%",
				background: "var(--dsw-alias-brand-primary)",
				color: "#ffffff",
				fontSize: "12px",
				lineHeight: "18px",
				textAlign: "center",
				fontWeight: 700
			},
			cardLabel: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "12px",
				lineHeight: "16px",
				whiteSpace: "nowrap"
			},
			cardLabelSelected: {
				color: "var(--dsw-alias-label-primary)"
			},
			swatch: {
				width: "100%",
				height: "52px",
				borderRadius: "8px",
				boxSizing: "border-box",
				padding: "8px",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				gap: "6px"
			},
			swatchLine: {
				height: "7px",
				borderRadius: "4px"
			},
			defaultSwatch: {
				width: "100%",
				height: "52px",
				borderRadius: "8px",
				boxSizing: "border-box",
				display: "flex",
				overflow: "hidden",
				border: "1px solid var(--dsw-alias-border-l2)"
			},
			button: {
				height: "32px",
				padding: "0 14px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "var(--dsw-alias-button-elevated-fill)",
				color: "var(--dsw-alias-label-primary)",
				cursor: "pointer",
				font: "inherit",
				fontSize: "13px",
				boxSizing: "border-box"
			},
			buttonDanger: {
				color: "var(--dsw-alias-state-error-primary)"
			},
			/**
			 * Small control (round-5 UI unification): the compact sibling of
			 * `button` — SAME radius (8px), SAME border token, SAME font stack,
			 * only smaller so secondary actions read as one family with the
			 * primary 32px buttons instead of a second design language.
			 */
			tinyButton: {
				height: "26px",
				padding: "0 10px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "transparent",
				color: "var(--dsw-alias-label-secondary)",
				cursor: "pointer",
				font: "inherit",
				fontSize: "12px",
				lineHeight: "24px",
				boxSizing: "border-box"
			},
			/**
			 * ONE selected language for every choice control (round-5): brand
			 * border + a subtle brand wash — used by segmented options, the
			 * share-copied state and any toggleable chip, matching the big
			 * material cards so "selected" looks the same everywhere. The wash
			 * is a var() with a static rgba fallback (blue-team R5-5) instead
			 * of color-mix, so webviews without color-mix keep the wash.
			 */
			tinyButtonActive: {
				color: "var(--dsw-alias-brand-primary)",
				borderColor: "var(--dsw-alias-brand-primary)",
				background: "var(--dsw-alias-brand-primary-soft, rgba(124, 92, 255, 0.12))"
			},
			urlInput: {
				flex: 1,
				minWidth: "220px",
				height: "32px",
				padding: "0 10px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "var(--dsw-alias-bg-layer-1)",
				color: "var(--dsw-alias-label-primary)",
				font: "inherit",
				fontSize: "13px",
				boxSizing: "border-box"
			},
			urlInvalidHint: {
				color: "var(--dsw-alias-state-error-primary)",
				fontSize: "12px",
				lineHeight: "18px"
			},
			presetswatches: {
				width: "48px",
				height: "32px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2)",
				cursor: "pointer",
				padding: 0
			},
			historyThumb: {
				width: "56px",
				height: "36px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2)",
				cursor: "pointer",
				padding: 0,
				boxSizing: "border-box",
				backgroundSize: "cover",
				backgroundPosition: "center"
			},
			accentPreset: {
				width: "24px",
				height: "24px",
				borderRadius: "50%",
				border: "1px solid rgba(128,128,128,0.4)",
				cursor: "pointer",
				padding: 0,
				boxSizing: "border-box"
			},
			accentDot: {
				width: "22px",
				height: "22px",
				borderRadius: "50%",
				border: "1px solid var(--dsw-alias-border-l2)",
				boxSizing: "border-box",
				flex: "none"
			},
			accentHex: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "13px",
				lineHeight: "20px",
				fontFamily: "ui-monospace, monospace"
			},
			checkbox: {
				accentColor: "var(--dsw-alias-brand-primary)",
				width: "16px",
				height: "16px"
			},
			preview: {
				width: "72px",
				height: "44px",
				objectFit: "cover",
				borderRadius: "6px",
				border: "1px solid var(--dsw-alias-border-l2)"
			},
			actionRow: {
				display: "flex",
				alignItems: "center",
				gap: "10px",
				flexWrap: "wrap"
			},
			sliderRow: {
				display: "flex",
				alignItems: "center",
				gap: "10px",
				minWidth: "240px"
			},
			sliderLabel: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "13px",
				whiteSpace: "nowrap",
				// F3 (round-7 review): auto width with a minimum — the fixed 90px
				// clipped the "?" help badge appended after longer labels
				// (输入框透明度/弹窗透明度) onto the slider track.
				minWidth: "90px",
				flex: "none"
			},
			slider: {
				flex: 1,
				accentColor: "var(--dsw-alias-brand-primary)"
			},
			sliderValue: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "12px",
				whiteSpace: "nowrap",
				width: "44px",
				textAlign: "right"
			}
		};

		/** Mini palette preview driven by one skin's token table. */
		function Swatch({ tokens }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...styles.swatch,
					background: tokens["--dsw-alias-bg-layer-1"],
					border: `1px solid ${tokens["--dsw-alias-border-l2"]}`
				},
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							...styles.swatchLine,
							width: "70%",
							background: tokens["--dsw-alias-label-primary"],
							opacity: 0.85
						}
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							...styles.swatchLine,
							width: "45%",
							background: tokens["--dsw-alias-brand-primary"]
						}
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							...styles.swatchLine,
							width: "55%",
							background: tokens["--dsw-alias-label-secondary"],
							opacity: 0.55
						}
					})
				]
			});
		}

		/** "Default" chip: follow the built-in appearance (light + dark halves). */
		function DefaultSwatch() {
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.defaultSwatch,
				children: [
					(0, react_jsx_runtime.jsx)("div", { style: { flex: 1, background: "#f4f4f5" } }),
					(0, react_jsx_runtime.jsx)("div", { style: { flex: 1, background: "#1c1c20" } })
				]
			});
		}

		/** One selectable skin card. */
		function SkinCard({ skin, selected, onSelect, t }) {
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: onSelect,
				"aria-pressed": selected,
				style: {
					...styles.card,
					...(selected ? styles.cardSelected : {})
				},
				children: [
					selected ? (0, react_jsx_runtime.jsx)("span", {
						style: styles.cardCheck,
						children: "✓"
					}) : null,
					(0, react_jsx_runtime.jsx)(Swatch, { tokens: skin.tokens }),
					(0, react_jsx_runtime.jsx)("span", {
						style: {
							...styles.cardLabel,
							...(selected ? styles.cardLabelSelected : {})
						},
						children: skin.label || t(`skin.${skin.id}`)
					})
				]
			});
		}

		/**
		 * Skin picker row registered into the Settings → General item slot,
		 * right after the built-in Appearance row: title + a "Default" chip and
		 * one swatch card per curated skin.
		 */
		function SkinRow({ t, setSkin, useStore }) {
			const skin = useStore((s) => s.skin);
			const selected = SKINS.some((candidate) => candidate.id === skin) ? skin : null;
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.group,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: styles.title,
						children: t("skin.title")
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.grid,
						children: [
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => setSkin(DEFAULT_SKIN),
								"aria-pressed": selected === null,
								style: {
									...styles.card,
									...(selected === null ? styles.cardSelected : {})
								},
								children: [
									(0, react_jsx_runtime.jsx)(DefaultSwatch, {}),
									(0, react_jsx_runtime.jsx)("span", {
										style: {
											...styles.cardLabel,
											...(selected === null ? styles.cardLabelSelected : {})
										},
										children: t("skin.default")
									})
								]
							}),
							SKINS.map((skinDefinition) => (0, react_jsx_runtime.jsx)(SkinCard, {
								skin: skinDefinition,
								selected: selected === skinDefinition.id,
								onSelect: () => setSkin(skinDefinition.id),
								t
							}, skinDefinition.id))
						]
					})
				]
			});
		}

		/** One labeled slider (opacity or blur). */
		/**
		 * "?" help badge (round-6): hover reveals a native-title tooltip.
		 * ALL explanatory copy lives in these badges now — no persistent hint
		 * paragraphs, the settings page stays scannable (cognitive-cost review).
		 * Reachability (blue-team F2): the visible "?" carries aria-label, so
		 * screen-reader users get the full text; mouse users get the native
		 * tooltip. Chromium does NOT show a title tooltip on keyboard focus —
		 * the badge is still tabbable so SR focus rings announce it, but the
		 * copy itself is authored for hover/screen-reader consumption.
		 */
		function HelpDot({ text }) {
			return (0, react_jsx_runtime.jsx)("span", {
				title: text,
				"aria-label": text,
				role: "note",
				tabIndex: 0,
				style: {
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: "15px",
					height: "15px",
					marginLeft: "5px",
					borderRadius: "50%",
					border: "1px solid var(--dsw-alias-border-l2, #666)",
					color: "var(--dsw-alias-label-secondary)",
					fontSize: "10px",
					lineHeight: "1",
					cursor: "help",
					userSelect: "none",
					flex: "none",
					verticalAlign: "middle"
				},
				children: "?"
			});
		}

		function Slider({ label, value, min, max, step, format, onChange, help }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.sliderRow,
				children: [
					(0, react_jsx_runtime.jsxs)("span", {
						style: styles.sliderLabel,
						children: [
							label,
							help ? (0, react_jsx_runtime.jsx)(HelpDot, { text: help }) : null
						]
					}),
					(0, react_jsx_runtime.jsx)("input", {
						type: "range",
						min,
						max,
						step,
						value,
						style: styles.slider,
						onChange: (event) => onChange(Number(event.target.value))
					}),
					(0, react_jsx_runtime.jsx)("span", {
						style: styles.sliderValue,
						children: format(value)
					})
				]
			});
		}

		/**
		 * Wallpaper row: choose (compressed to a data URL) and preview the
		 * wallpaper, plus the recent-history strip. All opacity/blur sliders
		 * live in the dedicated GlassRow below so every "how translucent is
		 * the glass" control sits in ONE group (cognitive-cost review).
		 */
		function WallpaperRow({ t, setWallpaper, applyFromHistory, useStore }) {
			const url = useStore((s) => s.url);
			const history = useStore((s) => s.history);
			const inputRef = (0, _react.useRef)(null);
			const onPick = () => inputRef.current?.click();
			const onFile = (event) => {
				const file = event.target.files?.[0];
				if (file === void 0) return;
				readImageAsDataUrl(file, (dataUrl) => {
					if (dataUrl !== null) setWallpaper(dataUrl);
					event.target.value = "";
				});
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.group,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: styles.title,
						children: [
							t("background.title"),
							// Round-6: persistent hint paragraph collapsed into the "?"
							// badge — help on hover, page stays scannable.
							(0, react_jsx_runtime.jsx)(HelpDot, { text: t("background.hint") })
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							url !== null ? (0, react_jsx_runtime.jsx)("img", {
								src: url,
								alt: "",
								style: styles.preview
							}) : null,
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: onPick,
								children: t("background.choose")
							}),
							url !== null ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...styles.button,
									...styles.buttonDanger
								},
								onClick: () => setWallpaper(null),
								children: t("background.remove")
							}) : null,
							(0, react_jsx_runtime.jsx)("input", {
								ref: inputRef,
								type: "file",
								accept: "image/*",
								style: { display: "none" },
								onChange: onFile
							})
						]
					}),
					history && history.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
						style: { padding: "0" },
						children: [
							(0, react_jsx_runtime.jsx)("div", {
								style: styles.hint,
								children: t("background.history")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: styles.actionRow,
								children: history.map((entry, i) => {
									// URL entries must be wrapped in url("...") too — a bare
									// URL string is not a valid CSS background value and would
									// render a blank thumbnail (gradients are fine as-is).
									const isImage = entry.kind !== "gradient" && entry.kind !== "url";
									const bg = isImage || entry.kind === "url"
										? `url("${cssUrlValue(entry.value)}") center/cover no-repeat`
										: entry.value;
									return (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: t("background.historyApply"),
										style: {
											...styles.historyThumb,
											background: bg
										},
										onClick: () => applyFromHistory(entry.kind, entry.value),
										children: null
									}, i);
								})
							})
						]
					}) : null
				]
			});
		}

		/**
		 * Glass-effect row: ONE group holding every translucency control —
		 * material preset (default / frosted / liquid glass), wallpaper
		 * opacity + blur, sidebar opacity (with its link toggle), composer
		 * (input box) opacity and popup opacity. Every slider reads as an
		 * opacity: higher = more solid, lower = more see-through.
		 * State is read through useStore (the host slot contract, same as every
		 * other row) — the injected bag only carries the action callbacks.
		 */
		function GlassRow({ t, setMaterialPreset, setOpacity, setBlur, setSidebarOpacity, setSidebarLink, setComposerOpacity, setModalOpacity, useStore }) {
			const materialPreset = useStore((s) => s.materialPreset);
			const opacity = useStore((s) => s.opacity);
			const blur = useStore((s) => s.blur);
			const sidebarOpacity = useStore((s) => s.sidebarOpacity);
			const composerOpacity = useStore((s) => s.composerOpacity);
			const modalOpacity = useStore((s) => s.modalOpacity);
			const [sidebarLink, setLink] = (0, _react.useState)(readSidebarLink());
			// Exactly TWO materials — frosted IS the factory default, liquid is
			// the upgrade. No third "default/none" chip (user review round 2).
			// Round 5: BIG preview cards (user: tiny chips "显不出来重要性")
			// — each card renders a live glass swatch showing the material's
			// own tone tail over the accent color, so the difference is
			// visible before clicking. The material is STYLE-ONLY: clicking
			// never moves any slider value. Tone strings are pulled from
			// MATERIAL_PRESETS (single source of truth, blue-team R5-4).
			const PRESETS = MATERIAL_PRESETS.map((p) => ({
				id: p.id,
				tone: p.tone,
				swatch: p.swatch,
				label: t("material." + p.id),
				desc: t("material." + p.id + ".desc")
			}));
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.group,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.title,
						children: [
							t("glass.title"),
							// "?" help badge (round 3): native title tooltip — zero
							// layout cost, works in every webview, no portal needed.
							(0, react_jsx_runtime.jsx)("span", {
								title: t("glass.help"),
								"aria-label": t("glass.help"),
								// Keyboard-reachable (blue-team B5): focus shows the native
								// tooltip in Chromium and lets SR users reach the text.
								tabIndex: 0,
								style: {
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									width: "16px",
									height: "16px",
									marginLeft: "6px",
									borderRadius: "50%",
									border: "1px solid var(--dsw-alias-border-l2, #666)",
									color: "var(--dsw-alias-label-secondary)",
									fontSize: "11px",
									lineHeight: "1",
									cursor: "help",
									userSelect: "none"
								},
								children: "?"
							})
						]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: { ...styles.actionRow, gap: "10px" },
						children: PRESETS.map((preset) => {
							const active = materialPreset === preset.id;
							return (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								"aria-pressed": active,
								// Round-6: material.hint lives as the card's hover tooltip.
								title: t("material.hint"),
								style: {
									flex: "1 1 0",
									display: "flex",
									flexDirection: "column",
									alignItems: "stretch",
									gap: "8px",
									padding: "10px",
									borderRadius: "10px",
									border: active
										? "1.5px solid var(--dsw-alias-brand-primary, #7c5cff)"
										: "1px solid var(--dsw-alias-border-l2, #666)",
									background: "transparent",
									color: "inherit",
									cursor: "pointer",
									textAlign: "left",
									font: "inherit",
									// Selected card keeps a subtle brand wash so the active
									// state is unmistakable at a glance. var() + static
									// rgba fallback instead of color-mix (blue-team R5-5):
									// no-color-mix webviews keep the wash too.
									boxShadow: active ? "0 0 0 3px var(--dsw-alias-brand-primary-soft, rgba(124, 92, 255, 0.18))" : "none"
								},
								onClick: () => setMaterialPreset(preset.id),
								children: [
									// Live glass swatch (round-9 lens recipe): a SHARP striped
									// backdrop ("the wallpaper") + a REAL backdrop-filter
									// lens you see it through — same layering as the actual
									// composer glass. frosted = thick milk (blur melts the
									// stripes); liquid = clear pane (stripes stay readable)
									// with a bright rim + sheen. The difference is structural,
									// not a filter tint.
									(0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": true,
										style: {
											display: "block",
											height: "44px",
											borderRadius: "7px",
											overflow: "hidden",
											position: "relative",
											// Sharp spectrum ribbon backdrop (user round-10: keep the
											// old spectral band, drop the stripes) — NOT filtered;
											// the lens on top is what the glass does to it.
											background: "linear-gradient(120deg, #f43f5e, #f59e0b 35%, #10b981 70%, #3b82f6)"
										},
										children: (0, react_jsx_runtime.jsx)("span", {
											style: {
												position: "absolute",
												inset: "6px",
												borderRadius: "5px",
												overflow: "hidden",
												// The GLASS LENS: a real backdrop-filter pane.
												WebkitBackdropFilter: preset.id === "none" ? "none" : `blur(${preset.swatch.blur}px) ${preset.swatch.filter}`,
												backdropFilter: preset.id === "none" ? "none" : `blur(${preset.swatch.blur}px) ${preset.swatch.filter}`,
												background: preset.swatch.fill,
												boxShadow: `inset 0 0 0 1px ${preset.swatch.rim}`
											},
											children: preset.swatch.sheen ? (0, react_jsx_runtime.jsx)("span", {
												style: {
													position: "absolute",
													inset: 0,
													// Diagonal sheen — screen-blended light sweep.
													background: "linear-gradient(135deg, rgba(255,255,255,0.5), rgba(255,255,255,0.08) 35%, transparent 60%)",
													mixBlendMode: "screen"
												}
											}) : null
										})
									}),
									(0, react_jsx_runtime.jsx)("span", {
										style: { fontWeight: 600, fontSize: "13px" },
										children: preset.label
									}),
									(0, react_jsx_runtime.jsx)("span", {
										style: { fontSize: "11px", opacity: 0.72, lineHeight: 1.35 },
										children: preset.desc
									})
								]
							}, preset.id);
						})
					}),
					(0, react_jsx_runtime.jsx)(Slider, {
						label: t("background.opacity"),
						// UI semantic is TRANSPARENCY (round 3): the slider shows
						// 100 − stored opacity and re-inverts on change, so dragging
						// right = more see-through. Storage stays opacity-based.
						value: 100 - Math.round(opacity * 100),
						min: 0,
						max: 100,
						step: 1,
						format: (v) => `${v}%`,
						onChange: (v) => setOpacity(100 - v)
					}),
					(0, react_jsx_runtime.jsx)(Slider, {
						label: t("background.blur"),
						value: blur,
						min: 0,
						max: 60,
						step: 1,
						format: (v) => `${v}px`,
						onChange: setBlur
					}),
					(0, react_jsx_runtime.jsx)(Slider, {
						label: t("background.sidebarOpacity"),
						value: 100 - Math.round(sidebarOpacity * 100),
						min: 0,
						max: 100,
						step: 1,
						format: (v) => `${v}%`,
						// Issue #55: while "跟随壁纸" is checked, shadeTokens2() uses
						// the CANVAS alpha and ignores this slider's stored value —
						// yet the control still dragged and still printed a
						// percentage, so it read as plain broken (the most common
						// "no effect" report). A drag here IS the user asking to
						// control the sidebar separately, so the ACTION releases the
						// link (see writeSidebarOpacityForSlider); this line only
						// mirrors that release into the LOCAL checkbox state in the
						// same commit, guarded by the SAME precondition as the
						// action, so the checkbox can never claim "off" while
						// storage still says on.
						onChange: (v) => {
							if (sidebarLink && hasWallpaperWash()) setLink(false);
							setSidebarOpacity(100 - v);
						},
						// Dedicated wording: the checkbox label describes the
						// CHECKBOX, not this auto-release, so reusing it here made
						// all 8 locales read "turn IT off to adjust separately"
						// next to a control that turns it off by itself.
						help: t("background.sidebarOpacityHint")
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: sidebarLink,
								style: styles.checkbox,
								onChange: (event) => { setLink(event.target.checked); setSidebarLink(event.target.checked); }
							}),
							(0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-label-secondary)", fontSize: "13px" },
								children: t("background.sidebarLink")
							})
						]
					}),
					(0, react_jsx_runtime.jsx)(Slider, {
						label: t("composer.opacity"),
						value: 100 - Math.round(composerOpacity * 100),
						min: 0,
						max: 100,
						step: 1,
						format: (v) => `${v}%`,
						onChange: (v) => setComposerOpacity(100 - v),
						// Round-6: hint collapsed into the "?" badge (hover to read).
						help: t("composer.hint")
					}),
					(0, react_jsx_runtime.jsx)(Slider, {
						label: t("modal.title"),
						value: 100 - Math.round(modalOpacity * 100),
						min: 0,
						max: 100,
						step: 1,
						format: (v) => `${v}%`,
						onChange: (v) => setModalOpacity(100 - v),
						help: t("modal.hint")
					})
				]
			});
		}

		/**
		 * Advanced wallpaper row (P0-3): a URL or gradient preset as the backdrop
		 * instead of a local image, plus an auto-dim toggle. Kept separate from
		 * the image row so the two workflows don't fight over the same preview.
		 */
		function WallpaperAdvancedRow({ t, useStore, setKind, setUrl, setGradient, setAutodim, setRefresh, clearAll }) {
			const kind = useStore((s) => s.kind);
			const url = useStore((s) => s.url);
			const gradient = useStore((s) => s.gradient);
			const autodim = useStore((s) => s.autodim);
			const refreshOn = useStore((s) => s.refreshOn);
			const refreshHours = useStore((s) => s.refreshHours);
			const urlState = (0, _react.useState)("");
			const urlValue = urlState[0];
			const setUrlValue = urlState[1];
			const KIND_OPTIONS = [
				{ id: "image", label: t("bg2.local") },
				{ id: "url", label: t("bg2.url") },
				{ id: "gradient", label: t("bg2.gradient") }
			];
			const GRADS = [
				"linear-gradient(135deg, #0b1120 0%, #172554 55%, #1e3a8a 100%)",
				"linear-gradient(135deg, #022c22 0%, #0d9488 100%)",
				"linear-gradient(135deg, #1e1b4b 0%, #7e22ce 100%)",
				"linear-gradient(135deg, #251607 0%, #c2410c 100%)",
				"linear-gradient(135deg, #faf5eb 0%, #e7dfcb 100%)",
				"linear-gradient(135deg, #fdf2f6 0%, #f0d2dc 100%)"
			];
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.group,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: styles.title,
						children: t("bg2.title")
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: KIND_OPTIONS.map((opt) => (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"aria-pressed": kind === opt.id,
							style: {
								...styles.tinyButton,
								...(kind === opt.id ? styles.tinyButtonActive : {})
							},
							onClick: () => setKind(opt.id),
							children: [opt.label]
						}, opt.id))
					}),
					kind === "url" ? (0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("input", {
								type: "url",
								placeholder: "https://example.com/wall.jpg",
								defaultValue: url || "",
								style: { ...styles.urlInput },
								onChange: (event) => setUrlValue(event.target.value)
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: () => setUrl(urlValue),
								children: t("bg2.apply")
							})
						]
					}) : null,
					kind === "url" && urlValue !== "" && !isSafeWallpaperUrl(urlValue) ? (0, react_jsx_runtime.jsx)("div", {
						style: styles.urlInvalidHint,
						children: t("bg2.urlInvalid")
					}) : null,
					kind === "url" ? (0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: refreshOn,
								style: styles.checkbox,
								onChange: (event) => setRefresh(event.target.checked, refreshHours)
							}),
							(0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-label-secondary)", fontSize: "13px" },
								children: t("bg2.refresh")
							})
						]
					}) : null,
					kind === "url" && refreshOn ? (0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-label-secondary)", fontSize: "13px" },
								children: t("bg2.refreshHours")
							}),
							(0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: 1,
								max: 720,
								step: 1,
								// Reflect the clamped, persisted value so the box can
								// never disagree with storage (R7: typing 9999 used to
								// keep showing 9999 while 720 was saved).
								value: refreshHours,
								style: { ...styles.urlInput, maxWidth: 88 },
								onChange: (event) => {
									const next = event.target.value;
									// Ignore the transient empty state; re-arm on commit.
									if (next === "") return;
									const n = Number(next);
									if (Number.isFinite(n)) setRefresh(true, n);
								}
							})
						]
					}) : null,
					kind === "gradient" ? (0, react_jsx_runtime.jsxs)("div", {
						style: styles.grid,
						children: GRADS.map((g) => (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-pressed": gradient === g,
							style: {
								...styles.presetswatches,
								background: g,
								...(gradient === g ? { outline: "2px solid var(--dsw-alias-brand-primary)" } : {})
							},
							onClick: () => setGradient(g),
							children: null
						}, g))
					}) : null,
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: autodim,
								style: styles.checkbox,
								onChange: (event) => setAutodim(event.target.checked)
							}),
							(0, react_jsx_runtime.jsx)("span", {
								style: { color: "var(--dsw-alias-label-secondary)", fontSize: "13px" },
								children: t("bg2.autodim")
							})
						]
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: { ...styles.button, ...styles.buttonDanger },
						onClick: clearAll,
						children: t("bg2.remove")
					})
				]
			});
		}

		//#endregion

		//#region dsh-dream-skin: P0 shared utilities (packs, accent, persistence, random)
		/**
		 * P0 feature layer: theme-pack import/export, per-user accent override,
		 * wallpaper 2.0, dual persistence, a local theme-pack library with
		 * one-click apply + validation + rollback, and surprise-me / favorites.
		 *
		 * Constraint note: DSH's Host settings wire only exposes an allowlisted
		 * set of namespaces to browser clients (WEB_SETTINGS_NAMESPACES in
		 * dsh-host-apiproxy), so a third-party namespace answers
		 * `settings-not-exposed` even when registered. localStorage/IndexedDB are
		 * therefore the reliable persistence for third-party state; a host
		 * settings write is attempted best-effort and never depended on.
		 */

		/** Pack manifest format marker. */
		const PACK_FORMAT = "dsh-dream-skin/pack";
		/** Current pack manifest version. */
		const PACK_VERSION = 1;
		/** Size cap for an imported pack JSON (≈1 MiB). */
		const PACK_MAX_BYTES = 1024 * 1024;
		/** localStorage keys for P0 state. */
		const PACKS_KEY = "dsh-dream-skin:packs"; // JSON array of remote/manual pack manifests
		const ACCENT_KEY = "dsh-dream-skin:accent"; // hex accent (#rrggbb) or "system"
		const FAVORITES_KEY = "dsh-dream-skin:favorites"; // JSON array of theme/ pack ids
		const WALLPAPER_URL_KEY = "dsh-dream-skin:wallpaper-url";
		const WALLPAPER_KIND_KEY = "dsh-dream-skin:wallpaper-kind"; // 'image'|'url'|'gradient'
		const WALLPAPER_GRADIENT_KEY = "dsh-dream-skin:wallpaper-gradient";
		const WALLPAPER_AUTODIM_KEY = "dsh-dream-skin:wallpaper-autodim"; // '1'|'0'
		// '1' = the wallpaper is the active skin's built-in diffused-glow gradient
		//       and should follow when the user switches skins (auto-swap).
		// '0' (or absent) = the user set a wallpaper themselves (image / URL /
		//       custom gradient) and switching skins must NOT clobber it.
		const WALLPAPER_FOLLOWS_SKIN_KEY = "dsh-dream-skin:wallpaper-follows-skin";
		// Optional scheduled refresh for URL wallpapers (issue #45): JSON
		// `{"on":0|1,"hours":N}`. When enabled, the plugin re-fetches the URL
		// wallpaper every N hours (cache-busted) so "daily wallpaper" APIs
		// (Bing daily etc.) roll over automatically. Default off; only acts
		// while the active wallpaper kind is `url` with a valid URL.
		const WALLPAPER_REFRESH_KEY = "dsh-dream-skin:wallpaper-refresh";
		/** Default refresh interval in hours (24 h = daily wallpaper). */
		const DEFAULT_REFRESH_HOURS = 24;
		/** Accepted refresh interval range (clamped). */
		const REFRESH_HOURS_MIN = 1;
		const REFRESH_HOURS_MAX = 24 * 30;
		/** How often the refresh scheduler checks whether a refresh is due. */
		const REFRESH_TICK_MS = 60 * 1000;
		/** Sentinel meaning "no accent override — follow the theme's own accent". */
		const DEFAULT_ACCENT = "system";
		/** Marker for a skin that is actually a user-imported pack. */
		const PACK_ID_PREFIX = "dream-pack:";

		/**
		 * Minimum token set a pack must define so it renders coherently.
		 * See docs/themes-spec.md for the full token contract. These are the
		 * core surfaces; missing others fall back to (or are shimmed from) these.
		 */
		const PACK_REQUIRED_TOKENS = [
			"--dsw-alias-bg-base",
			"--dsw-alias-bg-layer-1",
			"--dsw-alias-brand-primary",
			"--dsw-alias-label-primary",
			"--dsw-alias-label-secondary",
			"--dsw-alias-border-l1",
			"--dsw-alias-border-l2"
		];

		/** Regex for a 3/6-digit hex color. */
		const HEX_RE = /^#[\da-f]{3}(?:[\da-f]{3})?$/i;

		/** true when a value is a syntactically plausible CSS color. */
		function looksLikeColor(value) {
			return typeof value === "string" && (HEX_RE.test(value.trim()) || /^(rgb|rgba|hsl|hsla)\(/.test(value.trim()));
		}

		/** Normalize a hex to #rrggbb lowercase, or null. */
		function normalizeHex(value) {
			const m = HEX_RE.exec(String(value ?? "").trim());
			if (!m) return null;
			let hex = m[0].toLowerCase();
			if (hex.length === 4) hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
			return hex;
		}

		/**
		 * Validate a parsed pack manifest structure. Returns a { ok, errors }
		 * result WITHOUT mutating it. On ok, the caller receives a normalized copy
		 * with a guaranteed stable `id` and a merged full token table.
		 */
		function validatePack(data) {
			if (typeof data !== "object" || data === null) return { ok: false, errors: ["not an object"] };
			if (data.format !== PACK_FORMAT) return { ok: false, errors: [`format must be "${PACK_FORMAT}"`] };
			if (data.version !== PACK_VERSION) return { ok: false, errors: [`unsupported pack version ${data.version}`] };
			const manifest = data.manifest;
			if (typeof manifest !== "object" || manifest === null) return { ok: false, errors: ["missing manifest"] };
			if (typeof manifest.id !== "string" || !manifest.id.trim()) return { ok: false, errors: ["manifest.id is required"] };
			const id = PACK_ID_PREFIX + manifest.id;
			// Reserved-name check must run on the UNPREFIXED manifest id: with the
			// prefix prepended this comparison could never be true (a check that
			// looks like a defense but never fires).
			if (manifest.id === "system" || manifest.id === "light" || manifest.id === "dark") return { ok: false, errors: [`"${manifest.id}" collides with a reserved id`] };
			if (typeof manifest.name !== "string" || !manifest.name.trim()) return { ok: false, errors: ["manifest.name is required"] };
			if (manifest.colorScheme !== "light" && manifest.colorScheme !== "dark") return { ok: false, errors: [`colorScheme must be light|dark, got ${manifest.colorScheme}`] };
			if (typeof manifest.tokens !== "object" || manifest.tokens === null) return { ok: false, errors: ["manifest.tokens is required"] };
			const tokens = {};
			const errors = [];
			for (const name of PACK_REQUIRED_TOKENS) {
				const value = manifest.tokens[name];
				if (typeof value !== "string" || !looksLikeColor(value)) errors.push(`token ${name} is missing or not a color`);
				else tokens[name] = value;
			}
			// Copy the remaining user-supplied tokens (already owned/validated colors).
			for (const [name, value] of Object.entries(manifest.tokens)) {
				if (!(name in tokens) && typeof value === "string" && looksLikeColor(value)) tokens[name] = value;
			}
			const accent = manifest.accent ? normalizeHex(manifest.accent) : null;
			const pack = {
				format: PACK_FORMAT,
				version: PACK_VERSION,
				manifest: {
					id: manifest.id,
					name: manifest.name,
					nameZh: typeof manifest.nameZh === "string" ? manifest.nameZh : undefined,
					author: typeof manifest.author === "string" ? manifest.author : "anonymous",
					version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
					description: typeof manifest.description === "string" ? manifest.description : "",
					colorScheme: manifest.colorScheme,
					tokens,
					accent
				}
			};
			if (errors.length) return { ok: false, errors };
			return { ok: true, id, pack };
		}

		/** Turn a validated pack manifest into a ThemeRegistration for the runtime. */
		function packToRegistration(pack) {
			return Object.freeze({
				id: PACK_ID_PREFIX + pack.manifest.id,
				colorScheme: pack.manifest.colorScheme,
				tokens: { ...pack.manifest.tokens }
			});
		}

		/**
		 * In-process registry of imported packs. Kept outside React/localStorage
		 * so a pack can be registered into ctx.theme immediately on import and
		 * re-registered on reload without waiting for a slot mount.
		 */
		const importedPacks = [];
		/** Disposers for every pack we registered into ctx.theme, keyed by id. */
		const packDisposers = new Map();

		/** Register or refresh one pack into the theme runtime (idempotent). */
		function applyPackToTheme(ctx, id, registration) {
			const existing = packDisposers.get(id);
			if (existing) {
				existing(); // dispose old layer → theme reset if it was active
				packDisposers.delete(id);
			}
			packDisposers.set(id, ctx.theme.register(registration));
		}

		/** Dispose all packs (on plugin unload). */
		function disposeAllPacks() {
			for (const dispose of packDisposers.values()) dispose();
			packDisposers.clear();
			importedPacks.length = 0;
		}

		/** Read the persisted pack-manifest list. */
		function readPacks() {
			const raw = readStorage(PACKS_KEY);
			if (raw === null) return [];
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		}

		/** Persist the pack-manifest list (removing any entry whose id is empty). */
		function writePacks(packs) {
			writeStorage(PACKS_KEY, JSON.stringify(packs.filter((p) => p && p.id)));
		}

		/** Find a pack manifest by id. */
		function findPack(id) {
			return importedPacks.find((p) => p && p.id === id);
		}

		/** Import a validated pack: register it, add to the in-process + persisted list. */
		function importPack(ctx, result) {
			const { id, pack } = result;
			if (findPack(id)) return { ok: false, error: "a pack with this id is already imported" };
			const registration = packToRegistration(pack);
			try {
				applyPackToTheme(ctx, id, registration);
			} catch (e) {
				return { ok: false, error: "register failed: " + (e && e.message ? e.message : String(e)) };
			}
			const record = { id, manifest: pack.manifest };
			importedPacks.push({ ...record, registration });
			const packs = readPacks();
			packs.push({ id, manifest: pack.manifest });
			writePacks(packs);
			return { ok: true, id, name: pack.manifest.name, colorScheme: pack.manifest.colorScheme };
		}

		/** Remove an imported pack by id (falls back to built-in skin if it was active). */
		function unimportPack(ctx, id) {
			const idx = importedPacks.findIndex((p) => p && p.id === id);
			if (idx === -1) return;
			const [removed] = importedPacks.splice(idx, 1);
			const dispose = packDisposers.get(id);
			if (dispose) {
				dispose();
				packDisposers.delete(id);
			}
			const packs = readPacks().filter((p) => p.id !== id);
			writePacks(packs);
			// If the removed pack was active, fall back to the built-in appearance.
			if (ctx.theme.getTheme().preference === id) ctx.theme.setTheme(DEFAULT_SKIN);
			const favorites = readFavorites().filter((f) => f !== id);
			writeFavorites(favorites);
			return removed && removed.manifest ? removed.manifest.name : id;
		}

		/** Re-register persisted packs on (re)load, before restoring the saved skin. */
		function restorePacks(ctx) {
			for (const record of readPacks()) {
				if (!record || !record.manifest || !record.manifest.tokens) continue;
				const validate = validatePack({ format: PACK_FORMAT, version: PACK_VERSION, manifest: record.manifest });
				if (!validate.ok) continue;
				const regression = packToRegistration(validate.pack);
				try {
					applyPackToTheme(ctx, validate.id, regression);
					importedPacks.push({ id: validate.id, manifest: validate.pack.manifest, registration: regression });
				} catch {
					// skip a pack that fails to re-register
				}
			}
		}

		/** Export a pack as a downloadable JSON Blob (no server needed). */
		function exportPackAsFile(ctx, id) {
			// Built-in skins export their synthesized manifest (same shape the
			// share link produces) so "导出主题包文件" works for every theme —
			// this is the cross-machine path that does not bake the local
			// DSH origin (random port) into a URL.
			let manifest = null;
			const record = findPack(id);
			if (record) {
				manifest = { ...record.manifest };
			} else {
				const skin = SKINS.find((candidate) => candidate.id === id);
				if (skin) {
					manifest = {
						id: skin.id,
						name: skin.id,
						author: "dsh-dream-skin",
						version: "1.0.0",
						description: "",
						colorScheme: skin.colorScheme,
						tokens: { ...skin.tokens },
						accent: undefined
					};
				}
			}
			if (!manifest) return false;
			const source = { format: PACK_FORMAT, version: PACK_VERSION, manifest };
			const blob = new Blob([JSON.stringify(source, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = (source.manifest.name || id).toLowerCase().replace(/\s+/g, "-") + ".dsh-theme.json";
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			return true;
		}

		/** UTF-8 string → standard base64 (same bytes as the old escape/unescape path). */
		function encodeBase64Utf8(value) {
			const bytes = new TextEncoder().encode(value);
			let binary = "";
			for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
			return btoa(binary);
		}

		/** Standard base64 → UTF-8 string (decodes links made by older versions too). */
		function decodeBase64Utf8(value) {
			const binary = atob(value);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			return new TextDecoder().decode(bytes);
		}

		/** Encode a pack manifest into a shareable URL hash (fragment). */
		function packShareUrl(id) {
			// Built-in skins are shareable too: synthesize a pack manifest from the
			// skin's own token table so "复制分享链接" works for every visible theme,
			// not only imported packs (the silent no-op users read as "broken").
			let manifest = null;
			const record = findPack(id);
			if (record) {
				manifest = record.manifest;
			} else {
				const skin = SKINS.find((candidate) => candidate.id === id);
				if (skin) {
					manifest = {
						id: skin.id,
						name: skin.id,
						author: "dsh-dream-skin",
						version: "1.0.0",
						description: "",
						colorScheme: skin.colorScheme,
						tokens: { ...skin.tokens },
						accent: undefined
					};
				}
			}
			if (!manifest) return null;
			const payload = { format: PACK_FORMAT, version: PACK_VERSION, manifest };
			let encoded;
			try {
				encoded = encodeBase64Utf8(JSON.stringify(payload));
			} catch {
				return null;
			}
			return window.location.origin + window.location.pathname + "#dream-skin-pack=" + encoded;
		}

		/** Decode a shared pack from a URL hash; null when absent/invalid. */
		function decodeShareUrl(hash) {
			const prefix = "#dream-skin-pack=";
			const idx = hash ? hash.indexOf(prefix) : -1;
			if (idx === -1) return null;
			const raw = hash.slice(idx + prefix.length);
			if (!raw) return null;
			// Boot-path size gate (mirrors the file import's PACK_MAX_BYTES): a
			// pathological/malicious link must not run a giant base64+JSON.parse
			// synchronously during apply().
			if (raw.length > PACK_MAX_BYTES) return null;
			try {
				const json = decodeBase64Utf8(raw);
				const data = JSON.parse(json);
				const validate = validatePack(data);
				return validate.ok ? { id: validate.id, pack: validate.pack } : null;
			} catch {
				return null;
			}
		}

		/** Pull a desired accent from the active skin/registration + pack accent. */
		function resolveAccent(snapshot) {
			const active = snapshot.active;
			const brand = active && active.tokens ? active.tokens["--dsw-alias-brand-primary"] : null;
			return typeof brand === "string" && looksLikeColor(brand) ? brand : null;
		}

		//#region dsh-dream-skin: P0 favorites + surprise-me
		/** Read the favorites id list (built-in skins + imported pack ids). */
		function readFavorites() {
			const raw = readStorage(FAVORITES_KEY);
			if (raw === null) return [];
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
			} catch {
				return [];
			}
		}

		/** Persist the favorites list. */
		function writeFavorites(list) {
			writeStorage(FAVORITES_KEY, JSON.stringify(list));
		}

		/** Toggle a favorite id; returns true if it is now favorited. */
		function toggleFavorite(id) {
			const list = readFavorites();
			const idx = list.indexOf(id);
			if (idx === -1) {
				list.push(id);
				writeFavorites(list);
				return true;
			}
			list.splice(idx, 1);
			writeFavorites(list);
			return false;
		}

		/** All applyable theme ids (built-in skins + imported packs). */
		function allThemeIds() {
			const built = SKINS.map((s) => s.id);
			for (const p of importedPacks) if (p && p.id) built.push(p.id);
			return built;
		}

		/** Pick a different random theme id than the current one. */
		function randomThemeId(exclude) {
			const ids = allThemeIds().filter((id) => id !== exclude);
			if (ids.length === 0) return null;
			return ids[Math.floor(Math.random() * ids.length)];
		}
		//#endregion

		//#region dsh-dream-skin: P0 stores + module hooks
		/** Accent row slot store. */
		function createAccentStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({ accent: DEFAULT_ACCENT, base: DEFAULT_ACCENT, revision: -1 }),
				actions: {
					sync: (d, accent, base, revision) => {
						if (revision <= d.revision) return;
						d.accent = accent;
						d.base = base;
						d.revision = revision;
					}
				}
			});
		}

		/** Pack library row slot store (ids + names + favorites + active + suggestion). */
		function createPackStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({ ids: [], names: {}, favorites: [], active: null, suggestion: null, revision: -1 }),
				actions: {
					sync: (d, ids, names, favorites, active, suggestion, revision) => {
						if (revision <= d.revision) return;
						d.ids = ids;
						d.names = names;
						d.favorites = favorites;
						d.active = active;
						d.suggestion = suggestion;
						d.revision = revision;
					}
				}
			});
		}

		/** Suggested wallpaper gradient for a theme (P0-3 per-skin recommendation). */
		function wallpapersSuggestionsFor(activeId) {
            if (activeId === "tavern-terracotta") return "radial-gradient(ellipse at top right, rgba(204,120,92,.16), transparent 65%), linear-gradient(160deg, #faf9f5, #f5f0e8)";
            if (activeId === "tavern-terracotta-dark") return "radial-gradient(ellipse at top right, rgba(212,137,108,.14), transparent 65%), linear-gradient(160deg, #181715, #252320)";
			// iOS 弥散光高级感：多层 radial-gradient 表达柔和光斑 + 同色系暗部分层。
			// 每套皮肤对应一套与配色呼应的弥散光背景（而非生硬的 3 段线性渐变）。
			const suggestions = {
				abyss: [
					"radial-gradient(1100px 620px at 82% -8%, rgba(94, 106, 210, 0.35), transparent 60%)",
					"radial-gradient(820px 520px at 10% 110%, rgba(56, 189, 248, 0.18), transparent 55%)",
					"radial-gradient(1300px 820px at 48% 44%, rgba(30, 34, 48, 0.5), transparent 72%)",
					"linear-gradient(165deg, #121216 0%, #0d0d11 55%, #101016 100%)"
				].join(", "),
				aurora: [
					"radial-gradient(1100px 620px at 84% -8%, rgba(45, 212, 191, 0.30), transparent 60%)",
					"radial-gradient(820px 520px at 8% 110%, rgba(56, 189, 248, 0.14), transparent 55%)",
					"radial-gradient(1300px 820px at 50% 44%, rgba(16, 32, 32, 0.5), transparent 72%)",
					"linear-gradient(165deg, #0f151a 0%, #0c1212 55%, #0e1518 100%)"
				].join(", "),
				nebula: [
					"radial-gradient(1100px 620px at 82% -8%, rgba(139, 124, 246, 0.32), transparent 60%)",
					"radial-gradient(820px 520px at 12% 110%, rgba(126, 96, 220, 0.16), transparent 55%)",
					"radial-gradient(1300px 820px at 48% 44%, rgba(28, 24, 44, 0.5), transparent 72%)",
					"linear-gradient(165deg, #18141f 0%, #120f1c 55%, #14111e 100%)"
				].join(", "),
				ember: [
					"radial-gradient(1100px 620px at 84% -8%, rgba(245, 158, 91, 0.28), transparent 60%)",
					"radial-gradient(820px 520px at 8% 110%, rgba(200, 96, 40, 0.14), transparent 55%)",
					"radial-gradient(1300px 820px at 50% 44%, rgba(34, 24, 16, 0.5), transparent 72%)",
					"linear-gradient(165deg, #1c1712 0%, #161210 55%, #191310 100%)"
				].join(", "),
				midnight: [
					"radial-gradient(1000px 600px at 82% -8%, rgba(124, 140, 255, 0.20), transparent 60%)",
					"radial-gradient(1300px 800px at 48% 44%, rgba(24, 24, 30, 0.5), transparent 74%)",
					"linear-gradient(165deg, #0e0e12 0%, #08080c 55%, #0c0c10 100%)"
				].join(", "),
				ivory: [
					"radial-gradient(1000px 560px at 84% -6%, rgba(196, 164, 120, 0.30), transparent 60%)",
					"radial-gradient(780px 500px at 10% 110%, rgba(210, 190, 235, 0.22), transparent 58%)",
					"radial-gradient(1200px 780px at 50% 44%, rgba(255, 255, 255, 0.9), transparent 74%)",
					"linear-gradient(170deg, #faf7f1 0%, #f5f1e8 55%, #f8f4ec 100%)"
				].join(", "),
				mist: [
					"radial-gradient(1000px 560px at 84% -6%, rgba(159, 190, 245, 0.32), transparent 60%)",
					"radial-gradient(780px 500px at 10% 110%, rgba(140, 196, 220, 0.20), transparent 58%)",
					"radial-gradient(1200px 780px at 50% 44%, rgba(255, 255, 255, 0.92), transparent 74%)",
					"linear-gradient(170deg, #f6f8fb 0%, #f1f5fa 55%, #f5f8fc 100%)"
				].join(", "),
				rose: [
					"radial-gradient(1000px 560px at 84% -6%, rgba(214, 120, 160, 0.26), transparent 60%)",
					"radial-gradient(780px 500px at 10% 110%, rgba(230, 180, 205, 0.18), transparent 58%)",
					"radial-gradient(1200px 780px at 50% 44%, rgba(255, 255, 255, 0.92), transparent 74%)",
					"linear-gradient(170deg, #f8f4f6 0%, #f4eef2 55%, #f7f2f5 100%)"
				].join(", ")
			};
			return suggestions[activeId] || null;
		}

		/**
		 * Whether the user has explicitly set a wallpaper of any kind. When false
		 * (no wallpaper from the user), applying a skin can smart-attach that
		 * skin's recommended iOS diffused-glow gradient so the "material" side of
		 * the premium look appears automatically without clobbering a user choice.
		 */
		function userSetWallpaper() {
			const kind = readStorage(WALLPAPER_KIND_KEY);
			if (kind === "url" || kind === "gradient") return true;
			return readWallpaper() !== null;
		}

		/**
		 * Whether the current wallpaper is the active skin's built-in diffused-glow
		 * gradient and should follow when the user switches skins. When true, a skin
		 * switch swaps the wallpaper to the new skin's matching gradient; when the
		 * user has set their own wallpaper, this is false and switching skins leaves
		 * the wallpaper untouched.
		 * Compatibility: before the flag existed (≤0.4.0), a skin auto-attached its
		 * gradient without marking it. So if the current wallpaper is EXACTLY one of
		 * the built-in skin gradients, we still treat it as skin-following even when
		 * the flag is absent — fixing "switching skins didn't swap the background".
		 */
		function followsSkin() {
			if (readStorage(WALLPAPER_FOLLOWS_SKIN_KEY) === "1") return true;
			if (readStorage(WALLPAPER_KIND_KEY) !== "gradient") return false;
			const g = readStorage(WALLPAPER_GRADIENT_KEY);
			if (!g) return false;
			return SKINS.some((s) => wallpapersSuggestionsFor(s.id) === g);
		}

		/** Module-level hooks the PacksRow component uses to import/export/share. */
		let packsImportHandler = null;
		let packExporter = null;
		let packShare = null;

		/** Advanced wallpaper row store: kind + url + gradient + autodim. */
		function createAdvancedWallpaperStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({ kind: "image", url: null, gradient: null, autodim: false, refreshOn: false, refreshHours: DEFAULT_REFRESH_HOURS, revision: -1 }),
				actions: {
					sync: (d, kind, url, gradient, autodim, refreshOn, refreshHours, revision) => {
						if (revision <= d.revision) return;
						d.kind = kind;
						d.url = url;
						d.gradient = gradient;
						d.autodim = autodim;
						d.refreshOn = refreshOn;
						d.refreshHours = refreshHours;
						d.revision = revision;
					}
				}
			});
		}

		/** Popup-opacity row store: the current fill weight (0..1) + revision. */
		function createModalOpacityStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({ opacity: DEFAULT_MODAL_OPACITY, revision: -1 }),
				actions: {
					sync: (d, opacity, revision) => {
						if (revision <= d.revision) return;
						d.opacity = opacity;
						d.revision = revision;
					}
				}
			});
		}

		/**
		 * Glass-effect row store: every translucency value in ONE place — wallpaper
		 * opacity/blur, sidebar opacity, composer (input) opacity, popup opacity and
		 * the active material preset — written only by this plugin.
		 */
		function createGlassStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({
					opacity: DEFAULT_WALLPAPER_OPACITY,
					blur: DEFAULT_WALLPAPER_BLUR,
					sidebarOpacity: DEFAULT_SIDEBAR_OPACITY,
					composerOpacity: DEFAULT_COMPOSER_OPACITY,
					modalOpacity: DEFAULT_MODAL_OPACITY,
					materialPreset: DEFAULT_MATERIAL_PRESET,
					revision: -1
				}),
				actions: {
					sync: (d, opacity, blur, sidebarOpacity, composerOpacity, modalOpacity, materialPreset, revision) => {
						if (revision <= d.revision) return;
						d.opacity = opacity;
						d.blur = blur;
						d.sidebarOpacity = sidebarOpacity;
						d.composerOpacity = composerOpacity;
						d.modalOpacity = modalOpacity;
						d.materialPreset = materialPreset;
						d.revision = revision;
					}
				}
			});
		}
		//#endregion

		//#region dsh-dream-skin: P0 accent override
		/** Token names the accent override shades (brand + primary surfaces). */
		const ACCENT_TOKENS = [
			"--dsw-alias-brand-primary",
			"--dsw-alias-state-business-primary",
			"--dsw-alias-button-primary-fill",
			"--dsw-alias-button-primary-dimmed"
		];
		/** Cached accent currently applied (hex or null). */
		let appliedAccent = null;

		/**
		 * Read the persisted accent (`#rrggbb`, `${skinId}` to borrow a skin's
		 * accent, or `system` + null when unset).
		 */
		function readAccent() {
			// Tavern: the 强调色 row is gone, so an accent saved earlier no longer applies.
			const raw = null;
			if (raw === null || raw === DEFAULT_ACCENT) return null;
			if (HEX_RE.test(raw.trim())) return raw.toLowerCase();
			const skin = SKINS.find((s) => s.id === raw.trim());
			return skin ? skin.tokens["--dsw-alias-brand-primary"] : null;
		}

		/** Apply (or clear) the accent override layer. Returns the accent used. */
		function applyAccent(ctx) {
			const accent = readAccent();
			if (accent === null) {
				accentTokenOverrides = {};
				applyCombinedTokenOverrides(ctx);
				appliedAccent = null;
				return null;
			}
			const pair = { light: accent, dark: accent };
			const overrides = {};
			for (const name of ACCENT_TOKENS) overrides[name] = pair;
			accentTokenOverrides = overrides;
			applyCombinedTokenOverrides(ctx);
			appliedAccent = accent;
			return accent;
		}

		/** Set (or clear with null) the accent override. */
		function setAccent(ctx, value) {
			writeStorage(ACCENT_KEY, value === null || value === DEFAULT_ACCENT ? null : String(value));
			return applyAccent(ctx);
		}
		//#endregion

		//#region dsh-dream-skin: P0 wallpaper 2.0 (url / gradient / auto-dim)
		/** Read wallpaper kind (image|url|gradient). */
		function readWallpaperKind() {
			const kind = readStorage(WALLPAPER_KIND_KEY);
			return kind === "url" || kind === "gradient" ? kind : "image";
		}

		/** Read the persistable wallpaper URL string (for url kind). */
		function readWallpaperUrl() {
			const raw = readStorage(WALLPAPER_URL_KEY);
			return raw && raw.length > 4 ? raw : null;
		}

		/**
		 * Whether a string is acceptable as a URL wallpaper. Only image schemes
		 * are allowed (http/https/data:image); javascript:, file:, vbscript: and
		 * friends are refused. Control characters (which would silently corrupt
		 * the CSS value) are rejected too. Quotes/backslashes are fine here —
		 * they are escaped later when the value is embedded into a CSS url().
		 */
		function isSafeWallpaperUrl(value) {
			if (typeof value !== "string" || value.trim().length < 5) return false;
			if (/[\u0000-\u001f\u007f]/.test(value)) return false;
			return /^(https?:|data:image\/)/i.test(value.trim());
		}

		/** Escape a wallpaper URL for embedding inside url("...") in a CSS value. */
		function cssUrlValue(value) {
			return value.replace(/[\\"]/g, (ch) => (ch === "\\" ? "\\\\" : "\\\""));
		}

		/** Read the gradient CSS (for gradient kind). */
		function readWallpaperGradient() {
			const raw = readStorage(WALLPAPER_GRADIENT_KEY);
			return raw && raw.length > 4 ? raw : null;
		}

		/** Whether auto-dim wallpapers while a task is focused. */
		function readWallpaperAutodim() {
			return readStorage(WALLPAPER_AUTODIM_KEY) === "1";
		}

		/** Persist auto-dim. */
		function writeWallpaperAutodim(on) {
			writeStorage(WALLPAPER_AUTODIM_KEY, on ? "1" : "0");
		}

		/**
		 * Strip our own cache-busting `t=<ms-epoch>` parameter from a URL.
		 * Idempotent, and leaves every other query parameter and the fragment
		 * untouched. Only a 13-digit (millisecond epoch) `t` value is treated as
		 * ours, so a user's own short `t=` parameter is never removed.
		 */
		function stripWallpaperBust(url) {
			if (typeof url !== "string" || url.indexOf("t=") === -1) return url;
			const hashIndex = url.indexOf("#");
			const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
			const body = hashIndex === -1 ? url : url.slice(0, hashIndex);
			const qIndex = body.indexOf("?");
			if (qIndex === -1) return url;
			const head = body.slice(0, qIndex);
			const kept = body.slice(qIndex + 1).split("&").filter((part) => part !== "" && !/^t=\d{13}$/.test(part));
			return head + (kept.length > 0 ? `?${kept.join("&")}` : "") + hash;
		}

		/**
		 * Read the scheduled-refresh config {on, hours, lastFiredAt}. The stored
		 * wallpaper URL always stays the user's clean URL — the cache-busting
		 * stamp lives only in `lastFiredAt` and is applied at render time, so a
		 * scheduled refresh can never pollute the persisted URL (blue-team R6).
		 */
		function readWallpaperRefreshConfig() {
			const raw = readStorage(WALLPAPER_REFRESH_KEY);
			if (raw !== null) {
				try {
					const parsed = JSON.parse(raw);
					if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
						const on = parsed.on === 1 || parsed.on === true;
						let hours = Number(parsed.hours);
						if (!Number.isFinite(hours)) hours = DEFAULT_REFRESH_HOURS;
						hours = Math.min(REFRESH_HOURS_MAX, Math.max(REFRESH_HOURS_MIN, Math.round(hours)));
						const lastFiredAt = Number(parsed.lastFiredAt);
						return { on, hours, lastFiredAt: Number.isFinite(lastFiredAt) && lastFiredAt > 0 ? lastFiredAt : 0 };
					}
				} catch { /* corrupt — fall through to default */ }
			}
			return { on: false, hours: DEFAULT_REFRESH_HOURS, lastFiredAt: 0 };
		}

		/** Persist the scheduled-refresh config, preserving lastFiredAt unless given. */
		function writeWallpaperRefreshConfig(cfg) {
			const prev = readWallpaperRefreshConfig();
			const lastFiredAt = Number(cfg.lastFiredAt);
			writeStorage(WALLPAPER_REFRESH_KEY, JSON.stringify({
				on: cfg.on ? 1 : 0,
				hours: Math.min(REFRESH_HOURS_MAX, Math.max(REFRESH_HOURS_MIN, Math.round(Number(cfg.hours) || DEFAULT_REFRESH_HOURS))),
				lastFiredAt: Number.isFinite(lastFiredAt) && lastFiredAt > 0 ? Math.round(lastFiredAt) : prev.lastFiredAt
			}));
		}

		/**
		 * Render-time cache-busting URL: the stored URL stays the user's clean
		 * URL and the stamp is appended only for the CSS value, so scheduled
		 * refreshes never accumulate `?t=` parameters in persisted state
		 * (blue-team R6). The stamp is the last refresh time, so the value is
		 * stable between refreshes (no needless re-downloads).
		 */
		function stampedWallpaperUrl(url, stamp) {
			const clean = stripWallpaperBust(url);
			// Split off any `#fragment` BEFORE appending: a query appended after
			// `#` lands inside the fragment, is never sent to the server, and the
			// browser keeps serving the cached image — i.e. scheduled refresh
			// silently becomes a no-op for every link carrying a fragment
			// (third-party review T1).
			const hashIndex = clean.indexOf("#");
			const hash = hashIndex === -1 ? "" : clean.slice(hashIndex);
			const body = hashIndex === -1 ? clean : clean.slice(0, hashIndex);
			return `${body}${body.includes("?") ? "&" : "?"}t=${stamp}${hash}`;
		}

		// ── scheduled URL-wallpaper refresh (issue #45; blue-team R5/R6) ───────
		// The scheduler lives at MODULE scope and is driven from apply(), never
		// from the settings row's mount callback: a closed (or future-virtualized)
		// settings panel must not be able to stop the schedule (R5). Due-ness is
		// computed from the persisted `lastFiredAt`, never from "when this page
		// happened to open" — so closing DSH overnight cannot reset a 24 h phase
		// (R5). The tick is only a wake-up; the boot catch-up and the
		// visibilitychange catch-up cover restarts, sleeping machines and tabs
		// that were closed for a day.
		let refreshTimer = null;
		let refreshVisibilityHandler = null;
		let refreshNotify = null;

		/** Run one scheduled refresh when due; true when a refresh was committed. */
		function runScheduledWallpaperRefresh(ctx) {
			const cfg = readWallpaperRefreshConfig();
			if (!cfg.on) return false;
			if (readWallpaperKind() !== "url") return false;
			const url = readWallpaperUrl();
			if (url === null || !isSafeWallpaperUrl(url)) return false;
			// One stamp, shared by the preload probe and the persisted value, so the
			// probe verifies exactly the URL that will be rendered (third-party
			// review P3: probe used raw Date.now() while persistence rounded it).
			const stamp = Math.round(Date.now());
			if (cfg.lastFiredAt > 0 && stamp - cfg.lastFiredAt < cfg.hours * 60 * 60 * 1000) return false;
			const clean = stripWallpaperBust(url);
			const commit = () => {
				writeWallpaperRefreshConfig({ on: true, hours: cfg.hours, lastFiredAt: stamp });
				writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
				applyWallpaper2(ctx);
				if (typeof refreshNotify === "function") refreshNotify();
			};
			// Preload before committing: a dead or blocked link keeps the current
			// wallpaper instead of silently blanking it (R6).
			if (typeof Image !== "function") {
				commit();
				return true;
			}
			try {
				const probe = new Image();
				probe.onload = () => { try { commit(); } catch {} };
				probe.onerror = () => {
					try { console.warn("[dsh-dream-skin] scheduled wallpaper refresh could not load the image — keeping the current wallpaper:", clean); } catch {}
				};
				probe.src = stampedWallpaperUrl(clean, stamp);
			} catch {
				commit();
			}
			return true;
		}

		/** (Re)arm the wake-up tick + visibility catch-up. Safe to call repeatedly. */
		function startWallpaperRefreshScheduler(ctx) {
			stopWallpaperRefreshScheduler();
			runScheduledWallpaperRefresh(ctx);
			if (typeof window.setInterval === "function") {
				refreshTimer = window.setInterval(() => {
					try { runScheduledWallpaperRefresh(ctx); } catch {}
				}, REFRESH_TICK_MS);
			}
			if (typeof document.addEventListener === "function") {
				refreshVisibilityHandler = () => {
					try {
						if (document.visibilityState !== "hidden") runScheduledWallpaperRefresh(ctx);
					} catch {}
				};
				document.addEventListener("visibilitychange", refreshVisibilityHandler);
			}
		}

		/** Stop the tick and detach the visibility listener (unmount / re-apply). */
		function stopWallpaperRefreshScheduler() {
			if (refreshTimer !== null) {
				try { window.clearInterval(refreshTimer); } catch {}
				refreshTimer = null;
			}
			if (refreshVisibilityHandler !== null && typeof document.removeEventListener === "function") {
				try { document.removeEventListener("visibilitychange", refreshVisibilityHandler); } catch {}
			}
			refreshVisibilityHandler = null;
		}

		/**
		 * Resolve the background-image CSS for the current wallpaper config, or
		 * null when no wallpaper is set.
		 */
		function wallpaperBackgroundCss() {
			const kind = readWallpaperKind();
			if (kind === "gradient") {
				const grad = readWallpaperGradient();
				return grad ? grad : null;
			}
			if (kind === "url") {
				const url = readWallpaperUrl();
				// A stored value that fails validation (older versions accepted
				// anything) is ignored at render time — never applied.
				if (url === null || !isSafeWallpaperUrl(url)) return null;
				// Scheduled-refresh cache-busting is a RENDER-layer concern: the
				// stored URL stays clean and the stamp comes from lastFiredAt.
				const refresh = readWallpaperRefreshConfig();
				const rendered = refresh.on && refresh.lastFiredAt > 0 ? stampedWallpaperUrl(url, refresh.lastFiredAt) : stripWallpaperBust(url);
				return `url("${cssUrlValue(rendered)}")`;
			}
			// legacy / image
			const data = readWallpaper();
			return data ? `url("${cssUrlValue(data)}")` : null;
		}

		/** Guards against re-entrant wallpaper re-shading (overrideTokens emits theme/change). */
		let _applyingWallpaper = false;

		/** Re-render the wallpaper backdrop from the current config. */
		function applyWallpaper2(ctx, snapshot = null) {
			// Re-entrancy guard: overrideTokens() below emits `theme/change`, which our
			// syncSkin listener would answer by calling applyWallpaper2 again — that
			// recursion would overflow the stack. Applying while already applying is a
			// no-op; the first (outermost) call performs the shading.
			if (_applyingWallpaper) return;
			_applyingWallpaper = true;
			try {
				const bg = wallpaperBackgroundCss();
				const urlIsSet = bg !== null;
				if (!urlIsSet) {
					teardownWallpaper(ctx);
					return;
				}
				if (wallpaperEl === null || !document.body.contains(wallpaperEl)) {
					wallpaperEl = document.createElement("div");
					wallpaperEl.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:center;background-repeat:no-repeat;";
					document.body.prepend(wallpaperEl);
				}
				const blur = readWallpaperBlur();
				wallpaperEl.style.backgroundImage = bg;
				wallpaperEl.style.filter = blur > 0 ? `blur(${blur}px)` : "none";
				// Auto-dim lowers the wash opacity when enabled.
				const baseFill = readWallpaperOpacity();
				const wash = readWallpaperAutodim() ? Math.min(baseFill, 0.45) : baseFill;
				shadeTokens2(ctx, wash, snapshot);
			} finally {
				_applyingWallpaper = false;
			}
		}

		/** Apply the wallpaper's token override layer with a configurable canvas wash. */
		function shadeTokens2(ctx, canvasAlpha, snapshot = null) {
			const current = snapshot || ctx.theme.getTheme();
			// ThemeRuntime composes token override layers into snapshot.active. Reading
			// the active value here would feed our previous wallpaper wash back into the
			// next wash and hide the newly selected skin's raw base/sidebar colors.
			const active = rawActiveTheme(current);
			// When "link sidebar to main canvas" is on (default), the sidebar wash
			// uses the SAME color AND alpha as the main canvas so the two halves
			// don't look split — and, critically, the same value on both sliders
			// now produces the SAME visual result (user review round 2: the old
			// path used the sidebar's own fill token, a different base color, so
			// identical alphas still looked different). When off, the sidebar
			// keeps its own token color under the separately configured alpha.
			const linked = readSidebarLink();
			const sidebarAlpha = linked ? canvasAlpha : readSidebarOpacity();
			const sidebarColor = (scheme) => linked
				? resolveBase(scheme, active)
				: resolveSidebar(scheme, active);
			const overrides = {
				"--dsw-alias-bg-base": {
					light: toRgba(resolveBase("light", active), canvasAlpha),
					dark: toRgba(resolveBase("dark", active), canvasAlpha)
				},
				// OPAQUE base color for the composer glass fill (blue-team B1): the
				// ::before fill color-mixes this token at the user's fill weight.
				// Mixing the washed --dsw-alias-bg-base instead would compound the
				// alphas (fill = canvasAlpha × fill%), so dragging the wallpaper
				// slider secretly thinned the input box and light skins + dark
				// wallpapers became unreadable. This token carries NO alpha — the
				// fill weight is decided by the composer slider alone.
				"--dsh-dream-skin-composer-base": {
					light: resolveBase("light", active),
					dark: resolveBase("dark", active)
				},
				"--dsw-specific-sidebar-fill": {
					light: toRgba(sidebarColor("light"), sidebarAlpha),
					dark: toRgba(sidebarColor("dark"), sidebarAlpha)
				}
			};
			wallpaperTokenOverrides = overrides;
			applyCombinedTokenOverrides(ctx);
		}

		// Wallpaper store bookkeeping lives at module scope so the module-level
		// helpers below (removeWallpaper / setWallpaperKind) can refresh the row
		// store. They are bound by apply() via wallpaperBound; before then the
		// optional chain makes syncWallpaper a safe no-op.
		let wallpaperRevision = 0;
		let wallpaperBound = null;
		/** Push the persisted wallpaper state into the Wallpaper row store (if bound). */
		function syncWallpaper() {
			wallpaperRevision += 1;
			// Store the raw data URL (not the CSS url(...) wrapper) so the
			// Wallpaper row can render an <img> preview and test `url !== null`.
			wallpaperBound?.sync(
				readWallpaper(),
				readWallpaperOpacity(),
				readWallpaperBlur(),
				readSidebarOpacity(),
				readWallpaperHistory(),
				wallpaperRevision
			);
		}

		/**
		 * Re-apply every persisted preference to the live UI: imported packs,
		 * the saved skin, the accent override and the wallpaper (including the
		 * sidebar wash opacity). Called once at boot from the localStorage seed
		 * (so the first paint is correct) and again when the host state arrives
		 * over /dream-skin/api (so the durable, origin-independent values win).
		 * Safe to call repeatedly: packs are disposed before re-registering,
		 * theme set is idempotent, and applyWallpaper2 has its own re-entrancy
		 * guard.
		 */
		/**
		 * Factory defaults (round-6): the author's shipped look - users get
		 * this exact setup on first launch (nebula skin, the bundled horse
		 * painting wallpaper, tuned glass numbers, bing-daily timed URL).
		 * Applied ONLY when a key has no stored value yet: a user who changed
		 * anything keeps their own choice. Dynamic/trail keys (history,
		 * favorites, packs, builtin-last) are deliberately NOT defaulted.
		 */
		const FACTORY_DEFAULTS = {
			[STORAGE_KEY]: "tavern-terracotta",
			[WALLPAPER_KIND_KEY]: "image",
			[WALLPAPER_KEY]: null,
			[WALLPAPER_URL_KEY]: null,
			[WALLPAPER_GRADIENT_KEY]: null,
			[WALLPAPER_OPACITY_KEY]: String(DEFAULT_WALLPAPER_OPACITY),
			[WALLPAPER_BLUR_KEY]: "3",
			// Read from SIDEBAR_DEFAULTS, never restated: the reader fallbacks
			// and this seed share one table (issue #55 review).
			[SIDEBAR_OPACITY_KEY]: String(SIDEBAR_DEFAULTS.opacity),
			[SIDEBAR_LINK_KEY]: SIDEBAR_DEFAULTS.link ? "1" : "0",
			[WALLPAPER_AUTODIM_KEY]: "1",
			[WALLPAPER_FOLLOWS_SKIN_KEY]: "0",
			[COMPOSER_OPACITY_KEY]: String(DEFAULT_COMPOSER_OPACITY),
			[MODAL_OPACITY_KEY]: String(DEFAULT_MODAL_OPACITY),
			[MATERIAL_PRESET_KEY]: DEFAULT_MATERIAL_PRESET,
			// Factory refresh OFF (blue-team B7): polling a third-party API on the
			// user's behalf (even hourly) must be an explicit opt-in, never a
			// default. The URL field stays pre-filled; the user enables the
			// schedule themselves. DEFAULT_REFRESH_HOURS (24h) applies once on.
			[WALLPAPER_REFRESH_KEY]: "{\"on\":0,\"hours\":24}",
		};
		/**
		 * Issue #51 (dynamic-port desktop shell): the visible wallpaper keys
		 * are NOT seeded during the boot pass. On an Electron shell whose core
		 * listens on a fresh port every launch the origin changes each start,
		 * so localStorage is ALWAYS empty at boot — "empty storage" here means
		 * "dynamic-port restart", not "first install". Seeding the factory
		 * wallpaper immediately painted the shipped look for one frame before
		 * the host state arrived and overwrote it (the reported flash).
		 * applyFactoryDefaults() parks a callback here instead; loadFromHost
		 * invokes it once the host probe settles, with whether the host state
		 * mentions any wallpaper key AT ALL: present (even "" = user-cleared)
		 * means the host is authoritative and the factory look must not
		 * resurrect; absent (or host unreachable) means no wallpaper decision
		 * exists yet, so the shipped look is seeded then — a few hundred ms
		 * later on a true first install, without ever flashing over a user.
		 */
		let seedDeferredFactoryWallpaper = null;
		const DEFERRED_WALLPAPER_KEYS = [
			WALLPAPER_KIND_KEY, WALLPAPER_KEY, WALLPAPER_URL_KEY, WALLPAPER_GRADIENT_KEY
		];
		/**
		 * Write every factory default that has no stored value yet. Runs at
		 * boot before the persisted-state restore, so first launch paints the
		 * full shipped look; existing users (any stored value present) are
		 * never touched. ONE-SHOT via the factory-applied marker: without it a
		 * user who CLEARS their wallpaper would get the bundled one resurrected
		 * on the next boot (blue-team round-6 fix).
		 */
		function applyFactoryDefaults() {
			// Load the persistent provenance snapshot BEFORE anything reads it
			// (blue-team T1): isFactorySeededValue()/hasUserState() must see the
			// cross-session factory provenance, not just this session's seals.
			loadFactorySnapshot();
			// Blue-team F1: the marker key is new in this build, so EVERY upgrader
			// lacks it — the marker alone cannot distinguish "fresh install" from
			// "existing user who never touched X". Upgraders must keep exactly
			// what they have (an untouched URL-wallpaper user would otherwise get
			// the factory 1h refresh schedule silently switched on). True first
			// install = NO plugin storage at all — probed below; the marker then
			// guards the rare "user cleared a value but kept others" case after.
			// Sentinel-key probing works across the 3-layer storage AND test
			// mocks that don't implement localStorage.length/key().
			// Blue-team B2: the list must cover EVERY user-visible preference key,
			// not just the factory ones — a user who only ever touched the sidebar
			// opacity or the auto-dim switch is still an existing user and must
			// not be force-seeded with the full factory look.
			let hasAnyStoredValue = false;
			const SENTINEL_KEYS = [
				STORAGE_KEY, WALLPAPER_KEY, WALLPAPER_KIND_KEY, WALLPAPER_URL_KEY,
				WALLPAPER_OPACITY_KEY, WALLPAPER_BLUR_KEY, WALLPAPER_HISTORY_KEY,
				WALLPAPER_GRADIENT_KEY, WALLPAPER_AUTODIM_KEY, WALLPAPER_FOLLOWS_SKIN_KEY,
				WALLPAPER_REFRESH_KEY, SIDEBAR_OPACITY_KEY, SIDEBAR_LINK_KEY,
				ACCENT_KEY, PACKS_KEY, FAVORITES_KEY, BUILTIN_LAST_KEY,
				COMPOSER_OPACITY_KEY, MODAL_OPACITY_KEY, MATERIAL_PRESET_KEY
			];
			for (const sk of SENTINEL_KEYS) {
				if (readStorage(sk) != null) {
					hasAnyStoredValue = true;
					break;
				}
			}
			if (readStorage(FACTORY_APPLIED_KEY) != null || hasAnyStoredValue) {
				// factory:true keeps this bookkeeping write off the host push
				// schedule too (post-release review 🟡-2) — the marker is an
				// internal key and is filtered from patches anyway.
				if (readStorage(FACTORY_APPLIED_KEY) == null) writeStorage(FACTORY_APPLIED_KEY, "1", { factory: true });
				return;
			}
			// Issue #51: split the seeding. Non-visual defaults (skin, accent,
			// opacities, preset…) seed immediately — they are token changes and
			// produce no visible flash even when the host later overrides them.
			// The wallpaper keys park until the host probe settles (see
			// seedDeferredFactoryWallpaper above): on a dynamic-port desktop
			// restart empty localStorage is the NORM, and seeding the shipped
			// wallpaper right away painted it for one frame before the host's
			// durable (possibly cleared) value arrived — the reported flash.
			for (const key of Object.keys(FACTORY_DEFAULTS)) {
				if (DEFERRED_WALLPAPER_KEYS.includes(key)) continue;
				if (readStorage(key) == null) writeStorage(key, FACTORY_DEFAULTS[key], { factory: true });
			}
			seedDeferredFactoryWallpaper = (hostHasWallpaper) => {
				// One-shot: whichever path gets here first (probe success or a
				// subsequent boot pass) consumes the pending seed. Returns whether
				// anything was written, so the caller knows a re-apply is needed.
				seedDeferredFactoryWallpaper = null;
				if (hostHasWallpaper) {
					// The host state mentions a wallpaper key — including null from
					// a user who CLEARED their wallpaper (the push is a full-state
					// replacement, so the key survives with a null value). The host
					// is the durable authority (blue-team B1): seeding the factory
					// look here would resurrect the shipped wallpaper over the
					// user's explicit "no wallpaper" exactly like the round-6 bug.
					return false;
				}
				let wrote = false;
				for (const key of DEFERRED_WALLPAPER_KEYS) {
					if (readStorage(key) == null) {
						writeStorage(key, FACTORY_DEFAULTS[key], { factory: true });
						wrote = true;
					}
				}
				return wrote;
			};
			writeStorage(FACTORY_APPLIED_KEY, "1", { factory: true });
		}

		function restorePersistedState(ctx) {
			applyFactoryDefaults();
			// P0: re-register previously imported packs before restoring a skin,
			// then import any pack shared via URL hash.
			disposeAllPacks();
			restorePacks(ctx);
			tryImportFromHash(ctx);

			// Restore the saved skin (no-op when already current).
			const saved = readSavedSkin();
			if (typeof saved === "string" && saved !== DEFAULT_SKIN && (SKINS.some((skinDefinition) => skinDefinition.id === saved) || importedPacks.some((p) => p.id === saved))) {
				const current = ctx.theme.getTheme().preference;
				// The saved id can be the LIGHT half of a scheme family, and the shipped
				// factory default is exactly that: apply the member the native preference
				// asks for instead of the raw saved id.
				const target = resolveSchemeSkin(saved, nativeScheme(ctx.theme.getTheme()));
				if (current !== target) ctx.theme.setTheme(target);
			} else {
				// No third-party skin active — restore the last concrete built-in
				// preference (dark/light) the user committed, so a remote browser's
				// process-local ui-theme scope being reset to `system` by a client
				// reload / agent-preset change (issue #11) is corrected here too.
				const builtinLast = readBuiltinLast();
				if (builtinLast !== null) {
					const current = ctx.theme.getTheme().preference;
					if (current !== builtinLast) ctx.theme.setTheme(builtinLast);
				}
			}
			// P0: apply the persisted per-user accent override.
			applyAccent(ctx);

			// Apply + push the wallpaper state (includes the sidebar opacity).
			applyWallpaper2(ctx);
			syncWallpaper();

			// Apply the persisted popup-fill weight so saved modal opacity re-applies.
			applyModalOpacity();
			// Apply the persisted composer (chat input) fill weight so the saved
			// input-box translucency re-applies on boot too.
			applyComposerOpacity();
			// Issue #50: mark the composer card by DOM shape so the glass rules
			// survive host class-hash re-rolls (dsh 0.1.5+).
			startComposerMarker();
			// Apply the persisted glass blur so the composer's backdrop-filter
			// picks up the saved 壁纸模糊 value on boot too.
			applyMaterialBlur();
			// Scale DSH's popup/overlay/menu backgrounds so saved popup opacity takes
			// effect on the real popovers & dropdowns (issue #9 follow-up).
			applyModalOverlay(ctx);
		}

		/** Clear wallpaper (all kinds) and its overrides. */
		function removeWallpaper(ctx) {
			writeStorage(WALLPAPER_KEY, null);
			writeStorage(WALLPAPER_URL_KEY, null);
			writeStorage(WALLPAPER_GRADIENT_KEY, null);
			writeStorage(WALLPAPER_KIND_KEY, null);
			teardownWallpaper(ctx);
			syncWallpaper();
		}

		/** Read recent wallpaper history entries [{kind,value}]. */
		function readWallpaperHistory() {
			const raw = readStorage(WALLPAPER_HISTORY_KEY);
			if (raw === null) return [];
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.value === "string") : [];
			} catch {
				return [];
			}
		}

		/** Persist the wallpaper history list. */
		function writeWallpaperHistory(list) {
			writeStorage(WALLPAPER_HISTORY_KEY, JSON.stringify(list.slice(0, WALLPAPER_HISTORY_MAX)));
		}

		/** Record a wallpaper setting into history (dedupe by kind+value, newest first). */
		function pushWallpaperHistory(kind, value) {
			if (value === null || value === undefined || value === "") return;
			const list = readWallpaperHistory();
			const deduped = list.filter((e) => !(e.kind === kind && e.value === value));
			deduped.unshift({ kind, value });
			writeWallpaperHistory(deduped);
		}

		/** Set a wallpaper by kind and value. Returns false when the value was refused. */
		function setWallpaperKind(ctx, kind, value) {
			// The URL kind accepts only validated image URLs; anything else is
			// refused before it can reach storage (history entries, state file
			// or an older session's localStorage all pass through here).
			if (kind === "url" && value !== null && !isSafeWallpaperUrl(value)) return false;
			writeStorage(WALLPAPER_KIND_KEY, kind);
			if (kind === "gradient") {
				writeStorage(WALLPAPER_GRADIENT_KEY, value);
			} else if (kind === "url") {
				writeStorage(WALLPAPER_URL_KEY, value);
			} else {
				writeStorage(WALLPAPER_KEY, value);
			}
			pushWallpaperHistory(kind, value);
			applyWallpaper2(ctx);
			syncWallpaper();
			return true;
		}
		//#endregion

		//#region dsh-dream-skin: P0 share-url import
		/** Try to import a pack shared via URL hash; true when one was imported. */
		function tryImportFromHash(ctx) {
			const decoded = decodeShareUrl(window.location.hash);
			if (!decoded) return false;
			// A share whose manifest is a BUILT-IN skin (packShareUrl synthesizes
			// those) must NOT be imported as a pack: that would create a frozen
			// `dream-pack:<id>` duplicate that silently diverges from the real skin
			// on plugin updates. The skin is already registered locally — just
			// select it and clear the hash.
			if (SKINS.some((skin) => skin.id === decoded.pack.manifest.id)) {
				const skinId = decoded.pack.manifest.id;
				try {
					if (ctx.theme.getTheme().preference !== skinId) ctx.theme.setTheme(skinId);
					writeSavedSkin(skinId);
				} catch {
					return false;
				}
				try {
					window.history.replaceState(null, "", window.location.pathname + window.location.search);
				} catch {
					// no-op
				}
				return true;
			}
			try {
				// A pack id already in the local library wins: do NOT let a share link
				// silently overwrite the registration (the library card would then show
				// the old manifest while the runtime uses the new tokens). Keep the
				// existing pack and just record the visit.
				const exists = importedPacks.some((p) => p && p.id === decoded.id);
				if (!exists) {
					applyPackToTheme(ctx, decoded.id, packToRegistration(decoded.pack));
					importedPacks.push({ id: decoded.id, manifest: decoded.pack.manifest, registration: packToRegistration(decoded.pack) });
				}
				const packs = readPacks();
				if (!packs.some((p) => p.id === decoded.id)) packs.push({ id: decoded.id, manifest: decoded.pack.manifest });
				writePacks(packs);
			} catch {
				// A bad import at boot must NOT consume the share link: keep the hash
				// so the user can retry (or notice the failure) on the next load.
				return false;
			}
			// Clear the hash so it doesn't re-import on every reload.
			try {
				window.history.replaceState(null, "", window.location.pathname + window.location.search);
			} catch {
				// no-op
			}
			return true;
		}
		//#endregion

		//#endregion

		//#region dsh-dream-skin: P0 UI rows (accent + packs)
		/** Curated accent presets users can pick with one click. */
		const ACCENT_PRESETS = [
			"#4f83f2", "#2563eb", "#34d399", "#22d3ee", "#a78bfa",
			"#fb923c", "#f87171", "#fbbf24", "#e879f9", "#f472b6",
			"#2dd4bf", "#a3e635"
		];

		/**
		 * Accent row: pick an arbitrary brand-accent color (or clear to follow
		 * the active theme). Uses an `<input type="color">` + the current accent
		 * preview swatch, stacked as an override layer via ctx.theme.
		 */
		function AccentRow({ t, setAccent, clearAccent, useStore }) {
			const accent = useStore((s) => s.accent);
			const base = useStore((s) => s.base);
			const activeValue = accent !== DEFAULT_ACCENT ? accent : base;
			const inputValue = normalizeHex(activeValue) || "#4f83f2";
			const accentPickerRef = (0, _react.useRef)(null);
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.group,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: styles.title,
						children: [
							t("accent.title"),
							// Round-6: hint collapsed into the "?" badge (hover to read).
							(0, react_jsx_runtime.jsx)(HelpDot, { text: t("accent.hint") })
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								style: { ...styles.accentDot, background: inputValue },
								children: null
							}),
							(0, react_jsx_runtime.jsx)("span", {
								style: styles.accentHex,
								children: inputValue
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: () => {
									if (accentPickerRef.current) accentPickerRef.current.click();
								},
								children: t("accent.pick")
							}),
							(0, react_jsx_runtime.jsx)("input", {
								ref: accentPickerRef,
								type: "color",
								value: inputValue,
								style: { display: "none" },
								onChange: (event) => setAccent(event.target.value)
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: () => {
									const next = randomAccent();
									setAccent(next);
								},
								children: t("accent.random")
							}),
							accent !== DEFAULT_ACCENT ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: { ...styles.button, ...styles.buttonDanger },
								onClick: clearAccent,
								children: t("accent.clear")
							}) : null
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: ACCENT_PRESETS.map((hex) => (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							title: hex,
							"aria-pressed": activeValue === hex,
							style: {
								...styles.accentPreset,
								background: hex,
								...(activeValue === hex ? { outline: "2px solid var(--dsw-alias-label-primary)", outlineOffset: "1px" } : {})
							},
							onClick: () => setAccent(hex),
							children: null
						}, hex))
					})
				]
			});
		}

		/** Pick a pleasant palette accent that differs from the current one. */
		function randomAccent() {
			const pool = ["#4f83f2", "#34d399", "#a78bfa", "#fb923c", "#f87171", "#22d3ee", "#fbbf24", "#e879f9", "#2dd4bf", "#f472b6", "#60a5fa", "#a3e635"];
			const current = readAccent();
			const candidates = pool.filter((c) => c !== current);
			return candidates[Math.floor(Math.random() * candidates.length)] || "#4f83f2";
		}

		/**
		 * Packs row: import a theme-pack JSON, apply / favorite themes in the
		 * library, export/share the current pack, and "surprise me".
		 */
		function PacksRow({ t, applyId, toggleFavorite, removePack, surprise, useStore }) {
			const packExport = typeof packExporter === "function" ? packExporter : null;
			const ids = useStore((s) => s.ids);
			const names = useStore((s) => s.names);
			const favorites = useStore((s) => s.favorites);
			const active = useStore((s) => s.active);
			const shareCopiedState = (0, _react.useState)(false);
			const shareCopied = shareCopiedState[0];
			const setShareCopied = shareCopiedState[1];
			const fileInput = (0, _react.useRef)(null);
			const importFile = () => { if (fileInput.current) fileInput.current.click(); };

			const onFile = (event) => {
				const file = event.target.files?.[0];
				if (file === void 0) return;
				if (file.size > PACK_MAX_BYTES) {
					event.target.value = "";
					return;
				}
				const reader = new FileReader();
				reader.onerror = () => {
					event.target.value = "";
				};
				reader.onload = () => {
					let data = null;
					try {
						data = JSON.parse(String(reader.result));
					} catch {
						data = null;
					}
					if (data !== null && packsImportHandler) {
						packsImportHandler(null, data); // handler wraps validatePack + importPack
					}
					event.target.value = "";
				};
				reader.readAsText(file);
			};

			/**
			 * Copy the share link with a guaranteed user-visible outcome. Three
			 * layers, because "no reaction" was the reported bug:
			 *   1. nothing shareable active → an alert explains WHY (was: silence);
			 *   2. navigator.clipboard works → the button label flashes "已复制 ✓";
			 *   3. clipboard unavailable / rejected (http remote origins, older
			 *      webviews) → fallback to a hidden textarea + document.execCommand
			 *      copy, and if THAT fails too, an alert shows the URL to copy by hand.
			 */
			const doShare = () => {
				const activeId = (active && ids.indexOf(active) !== -1)
					? active
					// A built-in skin is active (not in the pack ids list): still
					// shareable via its synthesized manifest — unless it is one of
					// the host's own built-in preferences (system/light/dark), which
					// have no tokens of ours to share.
					: (active && SKINS.some((skin) => skin.id === active) ? active : null);
				if (!activeId || !packShare) {
					try { window.alert(localeT("packs.shareUnavailable")); } catch {}
					return;
				}
				const url = packShare(activeId);
				if (!url) {
					try { window.alert(localeT("packs.shareUnavailable")); } catch {}
					return;
				}
				const flashCopied = () => {
					setShareCopied(true);
					setTimeout(() => setShareCopied(false), 1600);
				};
				const legacyCopy = () => {
					try {
						const textarea = document.createElement("textarea");
						textarea.value = url;
						textarea.setAttribute("readonly", "");
						textarea.style.position = "fixed";
						textarea.style.opacity = "0";
						document.body.appendChild(textarea);
						textarea.select();
						const ok = document.execCommand("copy");
						textarea.remove();
						return ok;
					} catch {
						return false;
					}
				};
				let finished = false;
				const succeed = () => {
					if (finished) return;
					finished = true;
					flashCopied();
				};
				const fail = () => {
					if (finished) return;
					finished = true;
					try { window.alert(localeT("packs.shareFailed", { url })); } catch {}
				};
				// Single finished gate: late callbacks after a fallback already ran
				// (or a late success after the failure alert) are ignored, so the
				// button never flashes contradictory feedback twice.
				const fallback = () => {
					if (finished) return;
					if (legacyCopy()) succeed();
					else fail();
				};
				try {
					if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
						// A hung clipboard promise (permission prompt swallowed by some
						// webviews) must not leave the click without ANY reaction — race
						// it against a short timeout that falls back to legacyCopy.
						finished = false;
						Promise.race([
							navigator.clipboard.writeText(url).then(() => { succeed(); }),
							new Promise((resolve) => setTimeout(() => { resolve(); }, 2000))
						]).then(() => {
							fallback();
						}).catch(() => {
							fallback();
						});
					} else {
						fallback();
					}
				} catch {
					fallback();
				}
			};

			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.group,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						style: styles.title,
						children: t("packs.title")
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.actionRow,
						children: [
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: importFile,
								children: t("packs.import")
							}),
							(0, react_jsx_runtime.jsx)("input", {
								ref: fileInput,
								type: "file",
								accept: ".json,.dsh-theme.json,.dsh-theme,application/json",
								style: { display: "none" },
								onChange: onFile
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: () => surprise(),
								children: t("packs.surprise")
							}),
							active && packShare ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...styles.button,
									...(shareCopied ? styles.tinyButtonActive : {})
								},
								onClick: doShare,
								children: shareCopied ? t("packs.shareCopied") : t("packs.share")
							}) : null,
							// Cross-machine sharing path: a theme FILE does not bake the
							// local DSH origin (random port) into the payload, unlike the
							// share link. Works for imported packs AND built-in skins.
							active && packExport ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								onClick: () => {
									// Host built-in preferences (system/light/dark) have no
									// manifest to export — never leave the click silent
									// (blue-team F1): mirror the share button's alert.
									if (!packExport(active)) {
										try { window.alert(localeT("packs.shareUnavailable")); } catch {}
									}
								},
								children: t("packs.export")
							}) : null
						]
					}),
					ids.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
						style: styles.grid,
						children: ids.map((id) => {
							const fav = favorites.indexOf(id) !== -1;
							const label = names[id] || id;
							return (0, react_jsx_runtime.jsxs)("button", {
								key: id,
								type: "button",
								"aria-pressed": active === id,
								style: {
									...styles.card,
									...(active === id ? styles.cardSelected : {})
								},
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										style: styles.cardLabel,
										children: label
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										style: styles.actionRow,
										children: [
											(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: { ...styles.tinyButton },
												onClick: () => applyId(id),
												children: t("packs.apply")
											}),
											(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: { ...styles.tinyButton, ...(fav ? styles.tinyButtonActive : {}) },
												onClick: () => toggleFavorite(id),
												children: fav ? "★" : "☆"
											}),
											(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: { ...styles.tinyButton, ...styles.buttonDanger },
												onClick: () => removePack(id),
												children: t("packs.remove")
											})
										]
									})
								]
							});
						})
					}) : (0, react_jsx_runtime.jsx)("div", {
						style: styles.hint,
						children: t("packs.empty")
					})
				]
			});
		}
		//#endregion

		//#region dsh-dream-skin: Appearance settings section
		/**
		 * A dedicated "Theme / 外观" settings section. Hosts the skin, wallpaper,
		 * advanced wallpaper, accent and theme-pack rows — instead of flat rows in
		 * the General section, they live under their own category in the settings
		 * left nav.
		 */
		function DreamSkinSection({ renderSlot }) {
			return (0, react_jsx_runtime.jsx)("div", {
				style: styles.section,
				children: renderSlot("settings.dreamSkin.item", {})
			});
		}
		//#endregion
		//#region dsh-dream-skin: client plugin body
		/**
		 * Required services: theme runtime (skins, switching, token override
		 * layers), slots/locale (the settings rows). Persistence is
		 * localStorage, so no settings transport is needed.
		 */
		const inject = [
			"slots",
			"locale",
			"theme"
		];

		/**
		 * Client plugin body: register the curated skins into the theme runtime,
		 * restore the saved skin and wallpaper, keep the rows' stores in sync
		 * with theme/change, and register both rows into Settings → General.
		 * @param ctx - client cordis context.
		 */
// BEGIN TAVERN INTERFACE SKIN
// 界面皮肤: the active imported skin is one <style> appended after Tavern's own
// stylesheet, so its rules win at equal specificity. Every browser of this profile
// reads it on load; a change in settings re-applies it here at once.
const TAVERN_INTERFACE_SKIN_ID = "dsh-dream-skin/interface-skin";
const TAVERN_INTERFACE_SKIN_EVENT = "dsh-tavern-interface-skin-changed";
function installTavernInterfaceSkin(doc, css) {
    let style = doc.querySelector('style[data-plugin-css="' + TAVERN_INTERFACE_SKIN_ID + '"]');
    if (!css) { if (style) style.remove(); return; }
    if (!style) {
        style = doc.createElement("style");
        style.dataset.plugin = "dsh-dream-skin";
        style.dataset.pluginCss = TAVERN_INTERFACE_SKIN_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    // Last in <head>, after Tavern's stylesheet and any host style added since.
    if (style !== doc.head.lastElementChild) doc.head.appendChild(style);
}

function createInterfaceSkinModule({ React, rpc, dream, doc = document, target = window }) {
    let disposed = false, generation = 0;
    const order = new MutationObserver(() => {
        const style = doc.querySelector('style[data-plugin-css="' + TAVERN_INTERFACE_SKIN_ID + '"]');
        if (!disposed && style && style !== doc.head.lastElementChild) doc.head.appendChild(style);
    });
    order.observe(doc.head, {childList:true});
    async function applyActiveInterfaceSkin() {
        const current = ++generation;
        const result = await rpc("getActiveInterfaceSkin");
        if (disposed || current !== generation) return;
        if (result?.css && dream && !String(dream.current()).startsWith("tavern-terracotta")) dream.setSkin("tavern-terracotta");
        installTavernInterfaceSkin(doc, result?.css || "");
    }
    function changed() {
        void applyActiveInterfaceSkin().catch(report);
        target.dispatchEvent(new CustomEvent(TAVERN_INTERFACE_SKIN_EVENT));
    }
    function report(error) { console.warn("dsh-dream-skin: CSS skin unavailable", error); }
    function dispose() {
        disposed = true; generation++; order.disconnect();
        installTavernInterfaceSkin(doc, "");
    }

    // An imported skin has no colors to preview; draw it in the current theme's own colors.
    const IMPORTED_SKIN_PREVIEW = { "--dsw-alias-bg-layer-1": "var(--dsw-alias-bg-layer-1)", "--dsw-alias-border-l2": "var(--dsw-alias-border-l2)",
        "--dsw-alias-label-primary": "var(--dsw-alias-label-primary)", "--dsw-alias-brand-primary": "var(--dsw-alias-brand-primary)", "--dsw-alias-label-secondary": "var(--dsw-alias-label-secondary)" };
    // The base a CSS skin is drawn over: Tavern's own colors, following light/dark.
    const CSS_SKIN_BASE = "tavern-terracotta";

    // One 皮肤 row for every look: the bundled dream-skin's color skins (window.dshDreamSkin,
    // stored per browser by dream-skin) and Tavern's CSS skins (stored in the profile).
    // Exactly one is chosen; picking a color skin turns the CSS skin off.
    function InterfaceSkinSettings() {
        const h = React.createElement;

        const [index, setIndex] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        const [themeSkin, setThemeSkin] = React.useState(dream ? dream.current() : null);
        const fileInput = React.useRef(null);
        React.useEffect(function () {
            let active = true;
            rpc("listInterfaceSkins").then(function (result) { if (active) setIndex(result); }, function (err) { if (active) setMessage("读取失败：" + err.message); });
            const off = dream ? dream.onChange(function () { setThemeSkin(dream.current()); }) : null;
            return function () { active = false; if (typeof off === "function") off(); };
        }, []);
        async function run(method, args, notice) {
            setBusy(true); setMessage("");
            try { const next = await rpc(method, args); setIndex(next); changed(); if (notice) setMessage(notice); return next; }
            catch (err) { setMessage("失败：" + String(err && err.message || err)); throw err; }
            finally { setBusy(false); }
        }
        function chooseTheme(id) {
            const pick = function () { if (dream) { dream.setSkin(id); setThemeSkin(dream.current()); } };
            if (index && index.active) void run("selectInterfaceSkin", { id: null }).then(pick, function () {});
            else pick();
        }
        function chooseCss(id) {
            void run("selectInterfaceSkin", { id }).then(function () {
                if (dream && !String(dream.current()).startsWith(CSS_SKIN_BASE)) { dream.setSkin(CSS_SKIN_BASE); setThemeSkin(dream.current()); }
            }, function () {});
        }
        async function importFile(file) {
            if (!file) return;
            try { await run("importInterfaceSkin", { name: file.name, css: new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) }, "已导入并启用"); }
            catch (err) { setMessage("导入失败：" + String(err && err.message || err)); }
        }
        const cssSkins = index ? index.skins : [];
        const cssActive = index && index.active || null;
        const themeSkins = dream ? dream.skins() : [];
        const selected = cssActive ? "css:" + cssActive : themeSkins.some(function (skin) { return skin.id === themeSkin; }) ? "theme:" + themeSkin : "default";
        const activeCss = cssSkins.find(function (skin) { return skin.id === cssActive; });
        const disabled = !index || busy;
        const styles = dream ? dream.styles : {};
        function card(key, label, swatch, onSelect) {
            const on = selected === key;
            return h("button", { key, type: "button", disabled, "aria-pressed": on, title: label, onClick: onSelect,
                style: Object.assign({}, styles.card, on ? styles.cardSelected : null) },
                swatch,
                h("span", { style: Object.assign({}, styles.cardLabel, on ? styles.cardLabelSelected : null) }, label));
        }
        function swatch(tokens) { return dream ? h(dream.Swatch, { tokens }) : null; }
        return h("div", { style: styles.group },
            h("div", { style: styles.title }, "皮肤"),
            h("div", { style: styles.grid },
                dream ? card("default", dream.defaultLabel(), h(dream.DefaultSwatch), function () { chooseTheme("system"); }) : null,
                themeSkins.map(function (skin) { return card("theme:" + skin.id, skin.label, swatch(skin.tokens), function () { chooseTheme(skin.id); }); }),
                cssSkins.map(function (skin) { return card("css:" + skin.id, skin.name, swatch(skin.preview || IMPORTED_SKIN_PREVIEW), function () { chooseCss(skin.id); }); })),
            h("div", { style: styles.actionRow },
                h("button", { type: "button", style: styles.button, disabled, onClick: function () { fileInput.current && fileInput.current.click(); } }, "导入皮肤…"),
                activeCss && !activeCss.builtin ? h("button", { type: "button", style: styles.button, disabled, onClick: function () {
                    if (window.confirm("删除皮肤「" + activeCss.name + "」？")) void run("deleteInterfaceSkin", { id: activeCss.id }, "已删除").catch(function () {});
                } }, "删除这套皮肤") : null,
                h("input", { ref: fileInput, type: "file", accept: ".css,text/css", hidden: true, onChange: function (event) { const file = event.target.files && event.target.files[0]; event.target.value = ""; void importFile(file); } })),
            h("div", { role: "status", style: styles.hint }, message || "选一套皮肤，立即生效；导入别人分享的 .css 皮肤文件后也会出现在这里。皮肤只改外观，不影响正文和存档。"));
    }

    return { applyActiveInterfaceSkin, InterfaceSkinSettings, dispose };
}

function installInterfaceSkinSettings(ctx, React, dream) {
    const controller = new AbortController();
    async function rpc(method, args) {
        const response = await fetch('/dream-skin/api', {
            method:'POST', credentials:'same-origin', signal:controller.signal,
            headers:{'content-type':'application/json'}, body:JSON.stringify({method, args})
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error?.message || '皮肤请求失败');
        return result.value;
    }
    ctx.effect(() => {
        let skin, off;
        function dispose() {
            controller.abort();skin?.dispose();
            if (typeof off === 'function') off();else off?.dispose?.();
        }
        try {
            skin = createInterfaceSkinModule({React, rpc, dream});
            off = ctx.slots.inject('settings.dreamSkin.item', () => ctx.slots.register({
                name:'settings.dreamSkin.item', id:'dsh-tavern-interface-skin', order:26
            }, skin.InterfaceSkinSettings));
            void skin.applyActiveInterfaceSkin().catch(error => {
                if (!controller.signal.aborted) console.warn('dsh-dream-skin: CSS skin unavailable', error);
            });
        } catch (error) {
            dispose();
            console.warn('dsh-dream-skin: CSS skin registration failed', error);
        }
        return dispose;
    }, 'dsh-dream-skin: interface skin settings');
}

// END TAVERN INTERFACE SKIN
		function apply(ctx) {
			// Register the curated skins, YIELDING on an id collision instead of
			// throwing (blue-team R19). The host's ThemeRuntime.register throws on a
			// duplicate id (`theme "x" is already registered`), and our ids are
			// common words (mist, rose, ember, ivory…) that a third-party theme
			// plugin can plausibly take first. This call is NOT covered by the
			// factory-level dumb-module fallback (that only guards seed resolution),
			// so an unguarded throw here would escape apply(). Yielding degrades the
			// worst case to "one skin missing" — and the user still keeps their own
			// selection, since we only skip registration.
			const takenThemeIds = new Set(
				((ctx.theme.getTheme() || {}).themes || []).map((themeDefinition) => themeDefinition && themeDefinition.id)
			);
			const disposers = [];
			for (const skinDefinition of SKINS) {
				if (takenThemeIds.has(skinDefinition.id)) {
					try { console.warn(`[dsh-dream-skin] skin id "${skinDefinition.id}" is already registered by another plugin — skipping it`); } catch {}
					continue;
				}
				try {
					disposers.push(ctx.theme.register(skinDefinition));
				} catch (err) {
					// Defensive: a host that throws for another reason must not take
					// down the whole shell either.
					try { console.warn(`[dsh-dream-skin] could not register skin "${skinDefinition.id}":`, err && err.message); } catch {}
				}
			}
			ctx.effect(() => () => {
				for (const dispose of disposers) dispose();
			}, "dsh-dream-skin: theme registration");

			// Give DSH's leaf cards (composer, inline warnings, small popovers) a
			// premium liquid-glass material. Safe: these are not ancestors of any
			// fixed dialog, so it cannot re-trigger the settings-modal trapping bug.
			ensureMaterialStyle();

			// Restore every persisted preference (packs, skin, accent,
			// wallpaper) from the localStorage seed so the first paint is
			// correct; the host state fetched at the end of apply() re-runs
			// this via onHostReady so the durable values win.
			restorePersistedState(ctx);
			// The host ui-theme.preference scope only persists system/light/dark and is
			// adopted asynchronously after load — and RE-adopted on connection reset /
			// settings reload — which can reset a third-party skin restored above.
			// A once-only reassert cannot cover adoptions arriving later or repeated
			// re-adoptions, so use a sticky restore: whenever a saved third-party skin
			// survives while the host falls back to a built-in preference, re-apply it.
			// Writing the saved skin's own theme/change sets preference to the skin id
			// (not built-in), so this never self-triggers. A hard cap stops any
			// pathological adopt-loop. A deliberate Default selection clears the id
			// (via writeSavedSkin -> writeStorage key=null) before the deferred
			// callback reads it, so nothing is restored after an explicit reset.
			let skinRestoreCount = 0;
			const MAX_SKIN_RESTORES = 8;
			let restoreTimer = null;
			const restoreSavedSkin = () => {
				if (skinRestoreCount >= MAX_SKIN_RESTORES) return;
				const savedSkin = readSavedSkin();
				if (typeof savedSkin !== "string" || savedSkin === DEFAULT_SKIN) return;
				const known = SKINS.some((skinDefinition) => skinDefinition.id === savedSkin) || importedPacks.some((p) => p.id === savedSkin);
				if (!known) return;
				const current = ctx.theme.getTheme().preference;
				const target = resolveSchemeSkin(savedSkin, nativeScheme(ctx.theme.getTheme()));
				if (current === target) {
					// already in effect — reset the budget so an isolated adoption
					// later is still honored; the count is about consecutive failures.
					skinRestoreCount = 0;
					return;
				}
				if (current === "system" || current === "light" || current === "dark") {
					skinRestoreCount += 1;
					// Count the attempt before setTheme(): ThemeRuntime publishes the
					// successful saved-skin theme/change synchronously, and that event
					// resets this consecutive-failure budget below.
					ctx.theme.setTheme(target);
				}
			};
			const scheduleSkinRestore = () => {
				if (restoreTimer !== null) clearTimeout(restoreTimer);
				restoreTimer = setTimeout(restoreSavedSkin, 0);
			};
			restoreSavedSkin();
			// Built-in preference durability (issue #11): DSH persists the built-in
			// theme only to the host settings file for LOOPBACK browsers; a remote
			// browser keeps `ui-theme.preference` process-local, so a client reload /
			// agent-preset change resets a concrete `dark`/`light` choice back to
			// `system`. We keep our own copy (BUILTIN_LAST_KEY) and re-apply it on a
			// fallback to `system` that arrives in the boot/reset window right after
			// this plugin (re)mounts — the agent-preset-reload shape — while treating
			// a `system` switch that happens later, in a settled session, as an
			// explicit user choice that clears the record.
			let builtinSettled = false;
			let builtinSettleTimer = null;
			const BUILTIN_SETTLE_MS = 2000;
			// A `connection/reset` (which DSH fires when the client transport
			// re-adopts settings, e.g. after an agent-preset change) re-loads the
			// ui-theme scope and can reset a remote browser's process-local built-in
			// preference. Treat a `system` fallback that lands shortly after a reset
			// as a reset, not a deliberate choice.
			let resetPending = false;
			let resetTimer = null;
			const RESET_GRACE_MS = 2000;
			const settleBuiltin = () => {
				if (builtinSettleTimer !== null) clearTimeout(builtinSettleTimer);
				builtinSettleTimer = setTimeout(() => {
					builtinSettleTimer = null;
					builtinSettled = true;
				}, BUILTIN_SETTLE_MS);
			};
			const disarmReset = () => {
				resetPending = false;
				if (resetTimer !== null) { clearTimeout(resetTimer); resetTimer = null; }
			};
			const onBuiltinChange = (snapshot) => {
				const pref = snapshot.preference;
				if (pref === "light" || pref === "dark") {
					// A concrete built-in preference is a deliberate choice (the default
					// is `system`) — record it so a later reload can restore it.
					writeBuiltinLast(pref);
					settleBuiltin();
					return;
				}
				// pref === "system"
				if (readSavedSkinValid()) return; // third-party skin active
				const builtinLast = readBuiltinLast();
				if (builtinLast === null) return;
				if (!builtinSettled || resetPending) {
					// Reset/boot window — this `system` is an adoption reset, not a user
					// choice. Re-apply the recorded concrete preference.
					if (ctx.theme.getTheme().preference !== builtinLast) {
						ctx.theme.setTheme(builtinLast);
						disarmReset();
						settleBuiltin();
					}
				} else {
					// Settled, no reset — the user explicitly chose "system"/"follow OS";
					// drop the stale record so a future reload stays on `system`.
					writeBuiltinLast(null);
				}
			};
			// connection/reset re-arms the "this is a reset" window. Guarded: older /
			// test contexts may not provide the `connection` service, so only subscribe
			// when the event channel exists.
			try {
				ctx.on("connection/reset", () => {
					disarmReset();
					resetPending = true;
					resetTimer = setTimeout(disarmReset, RESET_GRACE_MS);
				});
			} catch {
				// connection service absent — fall back to the settle-window heuristic only
			}
			ctx.on("theme/change", (snapshot) => {
				const savedSkin = readSavedSkin();
				const builtIn = snapshot.preference === "system" || snapshot.preference === "light" || snapshot.preference === "dark";
				if (typeof savedSkin === "string" && savedSkin !== DEFAULT_SKIN) {
					if (snapshot.preference === savedSkin) {
						// A successful restore ends the failure streak. Without this reset,
						// ordinary locale reloads consume the lifetime cap and the ninth
						// reload permanently falls back to Default (issue #36).
						skinRestoreCount = 0;
					} else if (builtIn) {
						scheduleSkinRestore();
					}
				}
				onBuiltinChange(snapshot);
			});
			settleBuiltin();
			disarmReset();
			scheduleSkinRestore();
			ctx.effect(() => () => {
				if (restoreTimer !== null) clearTimeout(restoreTimer);
				if (builtinSettleTimer !== null) clearTimeout(builtinSettleTimer);
				if (resetTimer !== null) clearTimeout(resetTimer);
				// Adversarial-review F4: stop the composer marker's poll timer and
				// disconnect its MutationObserver on teardown instead of leaking.
				if (typeof composerMarkerDispose === "function") {
					try { composerMarkerDispose(); } catch {}
				}
			}, "dsh-dream-skin: sticky skin + built-in restore");
			// Wallpaper bookkeeping. The store revision counter and the sync
			// function live at module scope (see above) so module-level helpers
			// (removeWallpaper / setWallpaperKind) can refresh the row store too;
			// here we only create the store — the persisted wallpaper itself was
			// already applied by restorePersistedState() above.
			const wallpaperStore = createWallpaperStore();
			ctx.effect(() => () => {
				teardownWallpaper();
				teardownMaterial();
				disposeAllPacks();
				popupTokenOverrides = {};
				accentTokenOverrides = {};
				wallpaperTokenOverrides = {};
				combinedOverrideDispose?.();
				combinedOverrideDispose = null;
			}, "dsh-dream-skin: wallpaper + material + packs cleanup");

			const skinStore = createSkinStore();
			let skinBound;
			// Monotonic revision for the skin slot store. Using a locally incrementing
			// counter (instead of the host theme revision) guarantees the store ALWAYS
			// updates on every click — even if theme/change timing races or the host
			// revision doesn't bump as expected — so the selected card follows instantly.
			let skinRevision = 0;
			let wallpaperReshadeTimer = null;
			const syncSkinWith = (id) => {
				skinBound?.sync(id, ++skinRevision);
				// Do NOT re-shade the wallpaper here (issue #29): right after
				// ctx.theme.setTheme(id), the theme snapshot's `active` is not yet the
				// target skin, so shadeTokens2 -> resolveBase/sidebar cannot find the
				// target tokens and falls back to BUILTIN_BASE[scheme] (white for light),
				// writing a wrong wash (e.g. rgba(255,255,255,.8)) that persists until
				// refresh. The correct re-shade is deferred to the theme/change listener
				// (syncSkin), whose snapshot.active is already the settled target skin.
				// When this skin also swaps in a built-in glow gradient, setWallpaperKind
				// re-applies the wallpaper right after, so nothing is left stale.
			};
			const syncSkin = (snapshot) => {
				skinBound?.sync(snapshot.preference, ++skinRevision);
				// Theme events are synchronous. Re-shading inside this listener publishes a
				// nested theme/change; a presenter registered after us can then apply the
				// outer (pre-shade) snapshot last, leaving the wallpaper one skin behind.
				// Run after the current event stack instead. Events emitted by our own
				// override happen while _applyingWallpaper is true and must not enqueue a
				// second pass.
				if (wallpaperBackgroundCss() !== null && !_applyingWallpaper) {
					if (wallpaperReshadeTimer !== null) clearTimeout(wallpaperReshadeTimer);
					wallpaperReshadeTimer = setTimeout(() => {
						wallpaperReshadeTimer = null;
						applyWallpaper2(ctx, ctx.theme.getTheme());
					}, 0);
				}
			};
			ctx.on("theme/change", syncSkin);
			ctx.effect(() => () => {
				if (wallpaperReshadeTimer !== null) clearTimeout(wallpaperReshadeTimer);
			}, "dsh-dream-skin: deferred wallpaper re-shade");
			// Keep the Accent row's base color (the active theme's brand color) in
			// sync when the skin/scheme changes — otherwise a row with no custom
			// accent keeps showing the PREVIOUS skin's brand color until remount.
			ctx.on("theme/change", (snapshot) => {
				accentBound?.sync(
					readAccent() || DEFAULT_ACCENT,
					resolveAccent(snapshot) || DEFAULT_ACCENT,
					++accentRevision
				);
			});

			ctx.effect(() => ctx.locale.register(SETTINGS_NS, {
				zh,
				en,
				ja,
				ko,
				es,
				fr,
				de,
				ru
			}), "dsh-dream-skin: settings row dictionaries");

			// Bound translator for non-React code paths (import/remove alerts), so
			// user-facing messages follow the active locale instead of hardcoded text.
			// Fall back to an identity translator when the locale service has no
			// bind() (or registered dictionaries arrive later) — alerts must never
			// take the whole settings section down.
			const localeT = typeof ctx.locale?.bind === "function"
				? ctx.locale.bind(SETTINGS_NS)
				: (key) => key;

			const skinInjected = (actions) => {
				skinBound = actions;
				syncSkin(ctx.theme.getTheme());
				return {
					setSkin: (id) => {
						// Persist first: theme/change is synchronous. Wallpaper re-shading
						// must see the new selection (and Default must already have cleared
						// the old skin) while that event is being handled.
						writeSavedSkin(id);
						ctx.theme.setTheme(id);
						// Deterministically push the new preference into the slot store AND
						// re-shade the wallpaper so the selected card follows immediately,
						// independent of theme/change emission timing.
						syncSkinWith(id);
						// Every skin carries its own matching diffused-glow background.
						// When the wallpaper "follows the skin" (either it's already the
						// built-in glow, or the user has not set a custom wallpaper yet),
						// swapping skins swaps the background to the new skin's gradient.
						// A user-set custom wallpaper is never clobbered.
						const gradient = wallpapersSuggestionsFor(id);
						if (gradient && (followsSkin() || !userSetWallpaper())) {
							setWallpaperKind(ctx, "gradient", gradient);
							writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "1");
						}
					}
				};
			};
			// Register our own "Theme / 外观" settings section. It appears in the
			// settings left-nav and hosts all skin features (skin, wallpaper,
			// advanced wallpaper, accent, theme packs) under a single category.
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dream-skin",
				order: 10,
				label: "Theme / 外观",
				locale: SETTINGS_NS,
				children: { "settings.dreamSkin.item": {
					kind: "list",
					scope: "root"
				} }
			}, DreamSkinSection));

			// Tavern: no skin (配色) row here. Tavern's 皮肤 row lists these color skins next to
			// its CSS skins, so the player picks one look in one place; it drives them here.
			window.dshDreamSkin = Object.freeze({
				skins: () => SKINS.map((skin) => ({ id: skin.id, label: skin.label || localeT(`skin.${skin.id}`), tokens: skin.tokens })),
				defaultLabel: () => localeT("skin.default"),
				current: () => ctx.theme.getTheme().preference,
				onChange: (listener) => ctx.on("theme/change", listener),
				setSkin: (id) => skinInjected(skinBound).setSkin(id),
				Swatch,
				DefaultSwatch,
				styles
			});

			installInterfaceSkinSettings(ctx, _react, window.dshDreamSkin);

			const wallpaperInjected = (actions) => {
				wallpaperBound = actions;
				syncWallpaper();
				return {
					setWallpaper: (url) => {
						// A locally picked image switches the wallpaper back to the image
						// kind — otherwise a previously set gradient/URL would keep
						// winning in wallpaperBackgroundCss() and the preview would lie.
						writeStorage(WALLPAPER_KIND_KEY, "image");
						writeStorage(WALLPAPER_KEY, url);
						// A user-picked image is a custom wallpaper: it no longer follows
						// the skin, so switching skins must not swap it away.
						writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
						pushWallpaperHistory("image", url);
						applyWallpaper2(ctx);
						syncWallpaper();
					},
					setWallpaperUrl: (url) => {
						setWallpaperKind(ctx, "url", url && url.length > 4 ? url : null);
						writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
					},
					setWallpaperGradient: (gradient) => {
						setWallpaperKind(ctx, "gradient", gradient && gradient.length > 4 ? gradient : null);
						writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
					},
					setWallpaperKind,
					setOpacity: (percent) => {
						const value = Math.min(1, Math.max(0, percent / 100));
						writeStorage(WALLPAPER_OPACITY_KEY, String(value));
						// A slider move is a fine-tune WITHIN the chosen material —
						// same rule as GlassRow: the material chips stay put.
						applyWallpaper2(ctx);
						syncWallpaper();
					},
					setSidebarOpacity: (percent) => {
						writeSidebarOpacityForSlider(percent);
						applyWallpaper2(ctx);
						syncWallpaper();
					},
					setSidebarLink: (linked) => {
						writeStorage(SIDEBAR_LINK_KEY, linked ? "1" : "0");
						applyWallpaper2(ctx);
						syncWallpaper();
					},
					setBlur: (px) => {
						const value = Math.min(60, Math.max(0, px));
						writeStorage(WALLPAPER_BLUR_KEY, String(value));
						applyWallpaper2(ctx);
						// Keep the glass surfaces in step with the wallpaper slider
						// (the blur key feeds the wallpaper filter AND GLASS_BLUR_VAR
						// via applyMaterialBlur — refresh it so both stay live).
						applyMaterialBlur();
						syncWallpaper();
					},
					setAutodim: (on) => {
						writeWallpaperAutodim(!!on);
						applyWallpaper2(ctx);
						syncWallpaper();
					},
					applyFromHistory: (kind, value) => {
						const resolvedKind = kind === "gradient" || kind === "url" ? kind : "image";
						if (value && value.length > 4) {
							setWallpaperKind(ctx, resolvedKind, value);
							// Applying from recent history is a user choice, so it does
							// not follow the skin on later switches.
							writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
						} else {
							syncWallpaper();
						}
					},
					clearWallpaper: () => {
						removeWallpaper(ctx);
					}
				};
			};
			ctx.slots.inject("settings.dreamSkin.item", () => ctx.slots.register({
				name: "settings.dreamSkin.item",
				id: "dream-skin-wallpaper",
				order: 30,
				store: wallpaperStore,
				locale: SETTINGS_NS,
				inject: wallpaperInjected
			}, WallpaperRow));

			// P0: advanced wallpaper row (kind url / gradient / autodim).
			const advWallpaperStore = createAdvancedWallpaperStore();
			let advWallpaperBound;
			let advWallpaperRevision = 0;
			const syncAdvWallpaper = () => {
				advWallpaperBound?.sync(
					readWallpaperKind(),
					readWallpaperUrl(),
					readWallpaperGradient(),
					readWallpaperAutodim(),
					readWallpaperRefreshConfig().on,
					readWallpaperRefreshConfig().hours,
					++advWallpaperRevision
				);
			};
			const advWallpaperInjected = (actions) => {
				advWallpaperBound = actions;
				syncAdvWallpaper();
				// Scheduled refresh (issue #45) is owned by the module-scope
				// scheduler (see startWallpaperRefreshScheduler) so it survives a
				// closed settings panel; these actions only (re)arm it.
				return {
					setKind: (kind) => {
						if (kind !== "image" && kind !== "url" && kind !== "gradient") return;
						writeStorage(WALLPAPER_KIND_KEY, kind);
						applyWallpaper2(ctx);
						syncAdvWallpaper();
						startWallpaperRefreshScheduler(ctx);
					},
					setUrl: (url) => {
						const raw = typeof url === "string" ? url.trim() : "";
						// Mis-click guard (R13): pressing "Apply" on an untouched
						// (empty) input must not wipe an existing URL wallpaper —
						// clearing has its own button (clearAll / "清除壁纸").
						if (raw === "" || raw.length <= 4) {
							if (readWallpaperUrl() !== null) return;
							setWallpaperKind(ctx, "url", null);
							writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
							syncAdvWallpaper();
							startWallpaperRefreshScheduler(ctx);
							return;
						}
						if (!isSafeWallpaperUrl(raw)) {
							try { window.alert(localeT("bg2.urlInvalid")); } catch {}
							return;
						}
						// Store the clean URL: any `t=<ms>` stamp (from this plugin
						// or a pasted link) is stripped so persisted state never
						// carries cache-busting noise (R6).
						const clean = stripWallpaperBust(raw);
						setWallpaperKind(ctx, "url", clean);
						writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
						syncAdvWallpaper();
						startWallpaperRefreshScheduler(ctx);
						// Best-effort preload check: a dead link gets a one-shot
						// notice instead of silently showing nothing.
						const probe = new Image();
						probe.onerror = () => { try { window.alert(localeT("bg2.urlLoadFailed")); } catch {} };
						probe.src = clean;
					},
					setGradient: (gradient) => {
						setWallpaperKind(ctx, "gradient", gradient && gradient.length > 4 ? gradient : null);
						writeStorage(WALLPAPER_FOLLOWS_SKIN_KEY, "0");
						syncAdvWallpaper();
					},
					setAutodim: (on) => {
						writeWallpaperAutodim(!!on);
						applyWallpaper2(ctx);
						syncAdvWallpaper();
					},
					setRefresh: (on, hours) => {
						const cfg = readWallpaperRefreshConfig();
						const hoursNext = Number.isFinite(Number(hours)) ? Number(hours) : cfg.hours;
						// Validate BEFORE persisting (third-party review T2): the alert
						// used to fire after the config was already written, so a refused
						// toggle still landed as `on:1` in storage.
						if (on && readWallpaperKind() !== "url") {
							// Nothing to refresh yet — the user must pick a URL kind first.
							try { window.alert(localeT("bg2.refreshUrlOnly")); } catch {}
							syncAdvWallpaper();
							return;
						}
						writeWallpaperRefreshConfig({ on: !!on, hours: hoursNext });
						startWallpaperRefreshScheduler(ctx);
						syncAdvWallpaper();
					},
					clearAll: () => {
						removeWallpaper(ctx);
						stopWallpaperRefreshScheduler();
						// "Clear wallpaper" returns the whole feature to its default
						// state: dropping the stored config (rather than writing a
						// default one) also sidesteps the writer's "keep previous
						// lastFiredAt" rule, so a NEW wallpaper can never inherit the
						// deleted one's phase and fire immediately (third-party T3).
						writeStorage(WALLPAPER_REFRESH_KEY, null);
						syncAdvWallpaper();
					}
				};
			};
			ctx.slots.inject("settings.dreamSkin.item", () => ctx.slots.register({
				name: "settings.dreamSkin.item",
				id: "dream-skin-wallpaper-advanced",
				order: 32,
				store: advWallpaperStore,
				locale: SETTINGS_NS,
				inject: advWallpaperInjected
			}, WallpaperAdvancedRow));

			// Glass-effect row (统一「玻璃效果」组): material presets + every
			// opacity/blur slider in ONE group so the translucency controls are
			// never scattered across the section (cognitive-cost review).
			const glassStore = createGlassStore();
			let glassBound;
			let glassRevision = 0;
			const syncGlass = () => {
				glassBound?.sync(
					readWallpaperOpacity(),
					readWallpaperBlur(),
					readSidebarOpacity(),
					readComposerOpacity(),
					readModalOpacity(),
					readMaterialPreset(),
					++glassRevision
				);
			};
			const glassInjected = (actions) => {
				glassBound = actions;
				syncGlass();
				return {
					setMaterialPreset: (id) => {
						const preset = MATERIAL_PRESETS.find((p) => p.id === id);
						if (!preset) return;
						// Round-5 semantics (user decision): the material chip is a PURE
						// STYLE switch — it only changes the material character (the
						// glass look / blur character). It must NEVER touch the slider
						// numbers: whatever the user tuned stays until they tune it.
						// The blur knob owns the blur; the material just applies its
						// character on top (applyMaterialBlur reads the slider value).
						writeMaterialPreset(id);
						applyMaterialBlur();
						syncGlass();
					},
					setOpacity: (percent) => {
						const value = Math.min(1, Math.max(0, percent / 100));
						writeStorage(WALLPAPER_OPACITY_KEY, String(value));
						// A slider move is a fine-tune WITHIN the chosen material — the
						// material chips stay put (frosted remains frosted); only the
						// numbers drift. Two materials, no third "clear" state.
						applyWallpaper2(ctx);
						syncWallpaper();
						syncGlass();
					},
					setBlur: (px) => {
						const value = Math.min(60, Math.max(0, px));
						writeStorage(WALLPAPER_BLUR_KEY, String(value));
						applyWallpaper2(ctx);
						// Blur also feeds the live glass blur (composer / popups).
						applyMaterialBlur();
						syncWallpaper();
						syncGlass();
					},
					setSidebarOpacity: (percent) => {
						writeSidebarOpacityForSlider(percent);
						applyWallpaper2(ctx);
						syncWallpaper();
						syncGlass();
					},
					setSidebarLink: (linked) => {
						writeStorage(SIDEBAR_LINK_KEY, linked ? "1" : "0");
						applyWallpaper2(ctx);
						syncWallpaper();
						syncGlass();
					},
					setComposerOpacity: (percent) => {
						writeComposerOpacity(percent / 100);
						applyComposerOpacity();
						syncGlass();
					},
					setModalOpacity: (percent) => {
						const clamped = writeModalOpacity(percent / 100);
						applyModalOpacity();
						applyModalOverlay(ctx);
						modalOpacityBound?.sync(clamped, ++modalOpacityRevision);
						syncGlass();
					}
				};
			};
			ctx.slots.inject("settings.dreamSkin.item", () => ctx.slots.register({
				name: "settings.dreamSkin.item",
				id: "dream-skin-glass",
				order: 31,
				store: glassStore,
				locale: SETTINGS_NS,
				inject: glassInjected
			}, GlassRow));

			// Popup / option-card fill opacity row (legacy slot): the slider lives in
			// the glass row above; this keeps the modal store binding alive so the
			// shared setModalOpacity action can refresh it without remounting.
			const modalOpacityStore = createModalOpacityStore();
			let modalOpacityBound;
			let modalOpacityRevision = 0;
			const syncModalOpacity = () => {
				modalOpacityBound?.sync(readModalOpacity(), ++modalOpacityRevision);
			};
			const modalOpacityInjected = (actions) => {
				modalOpacityBound = actions;
				syncModalOpacity();
				return {
					// Legacy action kept for compatibility (older tests / external
					// callers): forwards to the same shared logic the glass row uses,
					// INCLUDING the glass-store sync so both sliders stay in step.
					setOpacity: (percent) => {
						const clamped = writeModalOpacity(percent / 100);
						applyModalOpacity();
						applyModalOverlay(ctx);
						modalOpacityBound?.sync(clamped, ++modalOpacityRevision);
						syncGlass();
					}
				};
			};
			ctx.slots.inject("settings.dreamSkin.item", () => ctx.slots.register({
				name: "settings.dreamSkin.item",
				id: "dream-skin-modal-opacity",
				order: 33,
				store: modalOpacityStore,
				locale: SETTINGS_NS,
				inject: modalOpacityInjected
			}, () => null));

			// P0: per-user accent override row.
			const accentStore = createAccentStore();
			let accentBound;
			let accentRevision = 0;
			const accentInjected = (actions) => {
				accentBound = actions;
				const base = resolveAccent(ctx.theme.getTheme()) || DEFAULT_ACCENT;
				// First sync must pass the store guard (`revision <= d.revision` rejects
				// when init revision is -1), so use the same monotonic counter as the
				// user actions — otherwise a saved accent never reaches the row UI on reload.
				accentBound?.sync(readAccent() || DEFAULT_ACCENT, base, ++accentRevision);
				return {
					setAccent: (value) => {
						const applied = setAccent(ctx, value === DEFAULT_ACCENT ? null : value);
						accentBound?.sync(
							applied || DEFAULT_ACCENT,
							resolveAccent(ctx.theme.getTheme()) || DEFAULT_ACCENT,
							++accentRevision
						);
					},
					clearAccent: () => {
						setAccent(ctx, null);
						accentBound?.sync(
							DEFAULT_ACCENT,
							resolveAccent(ctx.theme.getTheme()) || DEFAULT_ACCENT,
							++accentRevision
						);
					}
				};
			};
			// Tavern: no 强调色 row; skins own the colors, and an accent would only be painted over.

			// P0: theme-pack library + favorites + surprise-me row.
			const packStore = createPackStore();
			let packBound;
			let packRevision = 0;
			const syncPack = () => {
				const current = ctx.theme.getTheme().preference;
				// Carry a name lookup so the pack library renders manifest.name instead
				// of the raw `dream-pack:` id on each card.
				const names = {};
				for (const p of importedPacks) if (p && p.id) names[p.id] = p.manifest?.name || p.id;
				packBound?.sync(importedPacks.map((p) => p.id), names, readFavorites(), current, wallpapersSuggestionsFor(current), ++packRevision);
			};
			const refreshSurprise = () => {
				const id = randomThemeId(ctx.theme.getTheme().preference);
				if (id !== null) {
					ctx.theme.setTheme(id);
					writeSavedSkin(id);
				}
				syncPack();
				syncSkin(ctx.theme.getTheme());
			};
			const packInjected = (actions) => {
				packBound = actions;
				syncPack();
				return {
					applyId: (id) => {
						ctx.theme.setTheme(id);
						writeSavedSkin(id);
						syncPack();
						syncSkin(ctx.theme.getTheme());
					},
					toggleFavorite: (id) => {
						toggleFavorite(id);
						syncPack();
					},
					removePack: (id) => {
						const name = unimportPack(ctx, id);
						syncPack();
						syncSkin(ctx.theme.getTheme());
						if (name) { try { window.alert(localeT("packs.removed", { name })); } catch {} }
					},
					surprise: refreshSurprise
				};
			};
			// Tavern: no ä¸»é¢å row. Packs only held colors (the ç®è¤ row covers that) and
			// Tavern's çé¢ç®è¤ row takes custom looks; packs imported earlier still load.

			// Wire the shared "import a file" handler exposed to PacksRow via a
			// small module-level hook (the file input lives in the row component).
			packsImportHandler = (_ignoredCtx, data) => {
				const validate = (typeof data === "object" && data !== null) ? validatePack(data) : { ok: false, errors: ["invalid JSON or empty pack"] };
				if (!validate.ok) {
					try { window.alert(localeT("packs.rejected", { errors: (validate.errors || []).join("\n") })); } catch {}
					return { ok: false };
				}
				// A manifest whose id is a BUILT-IN skin (typical source: our own
				// "导出主题包文件" for a built-in skin) must NOT be imported as a
				// frozen dream-pack:<id> copy — same rule as the hash path. The
				// skin is already registered locally: just select it.
				if (validate.manifest && SKINS.some((skin) => skin.id === validate.manifest.id)) {
					const skinId = validate.manifest.id;
					// Switch OUTSIDE the try: a failed setTheme must not be reported
					// as a successful import (blue-team F2).
					let switched = false;
					try {
						if (ctx.theme.getTheme().preference !== skinId) ctx.theme.setTheme(skinId);
						writeSavedSkin(skinId);
						syncSkin(ctx.theme.getTheme());
						syncPack();
						switched = true;
					} catch {}
					try { window.alert(localeT("packs.imported", { name: skinId })); } catch {}
					return switched ? { ok: true, name: skinId } : { ok: false, error: "theme switch failed" };
				}
				const result = importPack(ctx, validate);
				try {
					if (!result.ok) window.alert(localeT("packs.importFailed", { error: result.error }));
					else { syncPack(); window.alert(localeT("packs.imported", { name: result.name })); }
				} catch {}
				return result;
			};
			packExporter = (id) => exportPackAsFile(ctx, id);
			packShare = (id) => packShareUrl(id);

			// Scheduled URL-wallpaper refresh (issue #45): armed from apply() so it
			// is independent of whether the settings panel is open (blue-team R5),
			// and torn down with the fiber on unmount / plugin re-apply.
			refreshNotify = () => { try { syncAdvWallpaper(); } catch {} };
			startWallpaperRefreshScheduler(ctx);
			ctx.effect(() => () => {
				stopWallpaperRefreshScheduler();
				refreshNotify = null;
			}, "dsh-dream-skin: wallpaper refresh scheduler");

			// Host-backed persistence: fetch the durable state ($DSH_HOME/
			// dream-skin.json) and re-apply it once it arrives, so the saved
			// skin / wallpaper / accent / packs survive the desktop app's
			// per-launch random port (which changes the origin and would
			// otherwise orphan the localStorage copy).
			onHostReady = () => restorePersistedState(ctx);
			loadFromHost();
		}
		//#endregion

		exports.SETTINGS_NS = SETTINGS_NS;
		exports.SKINS = SKINS;
		exports.DEFAULT_SKIN = DEFAULT_SKIN;
		exports.installInterfaceSkinSettings = installInterfaceSkinSettings;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

/* [调色板/绘画板 (Lucide palette classic)] settings nav 齿轮替换 — 与 dsh-memory/dsh-achievements 同款图标库方案 */
/* Blue-team B4: this IIFE sits OUTSIDE the loader's downgrade path — a throw
 * here would surface as "entries did not activate" and take down the web
 * shell. It is cosmetic, so ANY failure is swallowed: head/body may not exist
 * yet (script injected before <body> parses), MutationObserver may be
 * unavailable in stripped webviews. */
;(function () {
  try {
  var MARKER = "data-dsh-dream-skin-nav"
  var mask = "%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'24'%20height%3D'24'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'black'%20stroke-width%3D'2'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Ccircle%20cx%3D%2213.5%22%20cy%3D%226.5%22%20r%3D%221.05%22%2F%3E%3Ccircle%20cx%3D%2217.5%22%20cy%3D%2210.5%22%20r%3D%221.05%22%2F%3E%3Ccircle%20cx%3D%228.5%22%20cy%3D%227.5%22%20r%3D%221.05%22%2F%3E%3Ccircle%20cx%3D%226.5%22%20cy%3D%2212.5%22%20r%3D%221.05%22%2F%3E%3Cpath%20d%3D'M12%202C6.5%202%202%206.5%202%2012s4.5%2010%2010%2010c.926%200%201.648-.746%201.648-1.688%200-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64%201.64%200%200%201%201.668-1.668h1.996c3.051%200%205.555-2.503%205.555-5.554C21.965%206.012%2017.461%202%2012%202z'%2F%3E%3C%2Fsvg%3E"
  var css = "[" + MARKER + "] > svg:first-child{display:none}" +
    "[" + MARKER + "]::before{content:\"\";flex:none;width:16px;height:16px;background:currentColor;" +
    "-webkit-mask:url(\"data:image/svg+xml," + mask + "\") center/contain no-repeat;" +
    "mask:url(\"data:image/svg+xml," + mask + "\") center/contain no-repeat}"
  var style = document.createElement("style")
  style.id = "dsh-dream-skin-nav-icon"
  style.textContent = css
  ;(document.head || document.body).append(style)
  if (document.body) {
    var sync = function () {
      try {
        for (var b of document.querySelectorAll("[role=\"dialog\"] nav button")) {
          var label = (b.textContent || "").trim()
          var mm = label === "皮肤" || label === "Theme" || label.indexOf("Theme") !== -1
          if (mm) b.setAttribute(MARKER, "")
          else b.removeAttribute(MARKER)
        }
      } catch {}
    }
    sync()
    var mo = new MutationObserver(sync)
    mo.observe(document.body, { subtree: true, childList: true, characterData: true })
  }
  } catch {}
})()
