# DSH Tavern bundled Dream Skin

Based on [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin), npm version **9.23.0**, MIT (see LICENSE).

This plugin owns global interface appearance: color themes, wallpapers, imported CSS skins and the bundled Paper skin. Stage skins remain owned by the stage. Tavern exposes stable CSS variables and classes; it does not instantiate the skin store or register skin RPC/settings handlers.

CSS skins retain their existing profile location, `$DSH_HOME/profile-data/tavern/data/interface-skins/`. Requests use this plugin's authenticated `/dream-skin/api` endpoint. Disposing the CSS skin client aborts pending requests, removes its stylesheet and releases its settings registration and stylesheet observer.

Edit `src/interface-skin.js` and run `node bin/build-tavern-client.mjs`; `--check` verifies both client bundles. The vendoring command also integrates this source. The locally maintained host code is not overwritten by that command.

Tavern changes:
- Add light/dark Tavern Terracotta definitions from `tavern-themes.json`, with display labels in the native skin picker.
- The native light/dark preference drives which half of that pair is active. The two skins declare a shared `schemeFamily`, and every skin restore resolves the saved id against the built-in preference first — without it the stored (light) Terracotta id overrode a built-in `dark` on every boot, since a skin and the built-in preference share one `ui-theme.preference` slot.
- Fresh preferences select Tavern Terracotta, with no factory image, URL or gradient. Existing user preferences are retained by the upstream persistence logic.
- Skin selection still offers its built-in gradients; manually chosen wallpapers remain supported.

This runtime snapshot ships inside Tavern, including npm/Git installations. It is not independently published. Refresh with `node bin/vendor-dream-skin.mjs /path/to/unmodified/dsh-dream-skin-9.23.0` and rerun theme and package checks. No host dependency upgrade is required.
