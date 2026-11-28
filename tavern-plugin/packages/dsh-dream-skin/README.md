# DSH Tavern bundled Dream Skin

Based on [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin), npm version **9.23.0**, MIT (see LICENSE).

This plugin owns global interface appearance: color themes, wallpapers, imported CSS skins and the bundled Paper skin. The shared font catalog, verified download cache, font-file routes, face registration and picker also live here. Stage skin declarations and role precedence remain owned by the stage. Tavern exposes stable CSS variables and classes; it does not instantiate the skin store or register skin RPC/settings handlers.

CSS skins retain their existing profile location, `$DSH_HOME/profile-data/tavern/data/interface-skins/`. Requests use this plugin's authenticated `/dream-skin/api` endpoint. Disposing the CSS skin client aborts pending requests, removes its stylesheet and releases its settings registration and stylesheet observer.

Edit `src/interface-skin.js` or `tavern-themes.json` and run `node bin/build-tavern-client.mjs`. The build's `--check` verifies the generated client files. The vendoring command also integrates these sources. The locally maintained host code is not overwritten by that command.

Tavern changes:
- The native skin picker includes light and dark versions of Tavern Terracotta and all fifteen Bloom palettes. Bloom colors and names are adapted from [webkubor/dsh-bloom-theme](https://github.com/webkubor/dsh-bloom-theme/blob/ab06f1f05058afccfa3c040255ad89dc4a2157ea/src/palette.ts) under the [MIT license](lib/LICENSE-Bloom).
- Light and dark variants of a palette share a `schemeFamily`. The native light/dark preference selects the matching variant when the saved skin is restored.
- Fresh preferences select Tavern Terracotta, with no factory image, URL or gradient. Existing user preferences are retained by the upstream persistence logic.
- Skin selection still offers its built-in gradients; manually chosen wallpapers remain supported.
- Bloom's skin-following wallpaper paints a layered gradient on the conversation surface. The sidebars use softer gradients with neutral surfaces for selected rows and tabs. The default input material adds a tinted highlight using the existing opacity control.

This runtime snapshot ships inside Tavern, including npm/Git installations. It is not independently published. Refresh with `node bin/vendor-dream-skin.mjs /path/to/unmodified/dsh-dream-skin-9.23.0` and rerun theme and package checks. No host dependency upgrade is required.

Font files are served at `/dream-skin/fonts/` behind the same host-session and origin checks as the plugin API. `listFonts` is a method of `/dream-skin/api`, not Tavern RPC. Existing Profile `fonts/`, `cache/fonts/` and browser `dsh-tavern-font-*` selections stay unchanged. Installers adopt both the legacy release font directory and this package's font directory before cleanup. Downloads remain pinned to the original catalog revision and hashes.

The browser exposes `window.dshSkinFonts` with `list()`, `ensure(id)` and `createPicker({React, Icon, FloatingPanel, defaultApi})`. Consumers listen for `dsh-font-library-changed` to invalidate cached metadata on enable/disable, and fall back to system fonts without deleting their selections. Font faces and picker styles are removed when the plugin is disposed. The stage provides its own role resolver and popover to the shared picker.
