# DSH Tavern bundled Dream Skin

Based on [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin), npm version **9.23.0**, MIT (see LICENSE).

This plugin owns global interface appearance: color themes, wallpapers, imported CSS skins and the bundled Paper skin. The shared font catalog, verified download cache, font-file routes, face registration and picker also live here. Stage skin declarations and role precedence remain owned by the stage. Tavern exposes stable CSS variables and classes; it does not instantiate the skin store or register skin RPC/settings handlers.

CSS skins retain their existing profile location, `$DSH_HOME/profile-data/tavern/data/interface-skins/`. Requests use this plugin's authenticated `/dream-skin/api` endpoint. Disposing the CSS skin client aborts pending requests, removes its stylesheet and releases its settings registration and stylesheet observer.

Edit `src/interface-skin.js` and run `node bin/build-tavern-client.mjs`; `--check` verifies both client bundles. The vendoring command also integrates this source. The locally maintained host code is not overwritten by that command.

Tavern changes:
- Add light/dark Tavern Terracotta definitions from `tavern-themes.json`, with display labels in the native skin picker.
- The native light/dark preference drives which half of that pair is active. The two skins declare a shared `schemeFamily`, and every skin restore resolves the saved id against the built-in preference first — without it the stored (light) Terracotta id overrode a built-in `dark` on every boot, since a skin and the built-in preference share one `ui-theme.preference` slot.
- Fresh preferences select Tavern Terracotta, with no factory image, URL or gradient. Existing user preferences are retained by the upstream persistence logic.
- Skin selection still offers its built-in gradients; manually chosen wallpapers remain supported.

This runtime snapshot ships inside Tavern, including npm/Git installations. It is not independently published. Refresh with `node bin/vendor-dream-skin.mjs /path/to/unmodified/dsh-dream-skin-9.23.0` and rerun theme and package checks. No host dependency upgrade is required.

Font files are served at `/dream-skin/fonts/` behind the same host-session and origin checks as the plugin API. `listFonts` is a method of `/dream-skin/api`, not Tavern RPC. Existing Profile `fonts/`, `cache/fonts/` and browser `dsh-tavern-font-*` selections stay unchanged. Installers adopt both the legacy release font directory and this package's font directory before cleanup. Downloads remain pinned to the original catalog revision and hashes.

The browser exposes `window.dshSkinFonts` with `list()`, `ensure(id)` and `createPicker({React, Icon, FloatingPanel, defaultApi})`. Consumers listen for `dsh-font-library-changed` to invalidate cached metadata on enable/disable, and fall back to system fonts without deleting their selections. Font faces and picker styles are removed when the plugin is disposed. The stage provides its own role resolver and popover to the shared picker.
