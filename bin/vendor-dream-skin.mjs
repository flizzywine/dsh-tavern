import {integrateInterfaceSkin} from './build-interface-skin-client.mjs'
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
const source = process.argv[2]
if (!source) throw new Error('Pass an unmodified dsh-dream-skin 9.23.0 package directory')
const root = new URL('../tavern-plugin/packages/dsh-dream-skin/', import.meta.url)
const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-dream-skin' || manifest.version !== '9.23.0') throw new Error('Expected dsh-dream-skin 9.23.0')
let client = readFileSync(path.join(source, 'lib/client.js'), 'utf8').replaceAll('\r\n', '\n')
const themes = JSON.parse(readFileSync(new URL('tavern-themes.json', root), 'utf8'))
function replace(pattern, value) {
  if (!client.match(pattern)) throw new Error(`Upstream shape changed: ${pattern}`)
  client = client.replace(pattern, value)
}
replace(/const SKINS = \[/, 'const SKINS = [\n' + themes.map(t => JSON.stringify(t, null, 2)).join(',\n') + ',')
replace(/children: t\(`skin\.\$\{skin.id\}`\)/, 'children: skin.label || t(`skin.${skin.id}`)')
replace(/\[STORAGE_KEY\]: "nebula",/, '[STORAGE_KEY]: "tavern-terracotta",')
// Native scheme following. The built-in ui-theme preference (light/dark/system)
// and the third-party skin selection share ONE preference slot, so a skin takes
// the slot over and the native choice stops being readable from it. The sticky
// restore then forces the saved skin back no matter which scheme the user asked
// for -- and since the shipped factory default stores the LIGHT Terracotta id, a
// user whose built-in preference is dark was pushed back onto the light skin on
// every boot. Skins declaring the same schemeFamily are light/dark variants of
// one look, so recover the native scheme and select the matching family member
// instead of the raw saved id.
replace(/function rawActiveTheme\(snapshot\) \{/, `		/**
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
			// \`system\` on every reconnect (lock screen, app resume). That \`system\` is a
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
		function rawActiveTheme(snapshot) {`)
replace(/return snapshot\.themes\?\.find\(\(theme\) => theme\.id === selectedId\)/, 'const wantedId = resolveSchemeSkin(selectedId, nativeScheme(snapshot));\n\t\t\treturn snapshot.themes?.find((theme) => theme.id === wantedId)')
replace(/const current = ctx\.theme\.getTheme\(\)\.preference;\n(\t*)if \(current !== saved\) ctx\.theme\.setTheme\(saved\);/, 'const current = ctx.theme.getTheme().preference;\n$1// The saved id can be the LIGHT half of a scheme family, and the shipped\n$1// factory default is exactly that: apply the member the native preference\n$1// asks for instead of the raw saved id.\n$1const target = resolveSchemeSkin(saved, nativeScheme(ctx.theme.getTheme()));\n$1if (current !== target) ctx.theme.setTheme(target);')
replace(/const current = ctx\.theme\.getTheme\(\)\.preference;\n(\t*)if \(current === savedSkin\) \{/, 'const current = ctx.theme.getTheme().preference;\n$1const target = resolveSchemeSkin(savedSkin, nativeScheme(ctx.theme.getTheme()));\n$1if (current === target) {')
replace(/ctx\.theme\.setTheme\(savedSkin\);/, 'ctx.theme.setTheme(target);')
// Picking one half of a family in the skin picker is a scheme choice too; record
// it so the restore above does not flip the user back to the other half.
replace(/function writeSavedSkin\(id\) \{\n(\t*)writeStorage\(STORAGE_KEY, id === DEFAULT_SKIN \? null : id\);/, 'function writeSavedSkin(id) {\n$1writeStorage(STORAGE_KEY, id === DEFAULT_SKIN ? null : id);\n$1// Tavern: picking one half of a scheme family is also a scheme choice.\n$1// Record it, or the next restore would flip back to the other half.\n$1const skin = SKINS.find((skinDefinition) => skinDefinition.id === id);\n$1if (typeof skin?.schemeFamily === "string") writeBuiltinLast(skin.colorScheme);')
replace(/\[WALLPAPER_KEY\]: "data:image[^\n]+/, '[WALLPAPER_KEY]: null,')
replace(/\[WALLPAPER_URL_KEY\]: "https:[^\n]+/, '[WALLPAPER_URL_KEY]: null,')
replace(/\[WALLPAPER_GRADIENT_KEY\]: "radial-gradient[^\n]+/, '[WALLPAPER_GRADIENT_KEY]: null,')
// Host routes, package metadata and profile wiring are maintained locally.
for (const file of ['LICENSE']) copyFileSync(path.join(source, file), new URL(file, root))

replace(/function wallpapersSuggestionsFor\(activeId\) \{/, "function wallpapersSuggestionsFor(activeId) {\n            if (activeId === \"tavern-terracotta\") return \"radial-gradient(ellipse at top right, rgba(204,120,92,.16), transparent 65%), linear-gradient(160deg, #faf9f5, #f5f0e8)\";\n            if (activeId === \"tavern-terracotta-dark\") return \"radial-gradient(ellipse at top right, rgba(212,137,108,.14), transparent 65%), linear-gradient(160deg, #181715, #252320)\";")
// No 主题包 row: packs only held colors, and Tavern's 界面皮肤 row takes custom looks.
// Packs imported earlier still load and stay selectable in the 皮肤 row.
replace(/\t*ctx\.slots\.inject\("settings\.dreamSkin\.item", \(\) => ctx\.slots\.register\(\{\n\t*name: "settings\.dreamSkin\.item",\n\t*id: "dream-skin-packs",[\s\S]*?\}, PacksRow\)\);\n/, '\t\t\t// Tavern: no 主题包 row. Packs only held colors (the 皮肤 row covers that) and\n\t\t\t// the Tavern 界面皮肤 row takes custom looks; packs imported earlier still load.\n')
// One 皮肤 row lives in Tavern: drop the skin and accent rows and expose what that row needs.
replace(/\t*ctx\.slots\.inject\("settings\.dreamSkin\.item", \(\) => ctx\.slots\.register\(\{\n\t*name: "settings\.dreamSkin\.item",\n\t*id: "dream-skin",\n\t*order: 20,[\s\S]*?\}, SkinRow\)\);\n/, () => `			// Tavern: no skin (配色) row here. Tavern's 皮肤 row lists these color skins next to
			// its CSS skins, so the player picks one look in one place; it drives them here.
			window.dshDreamSkin = Object.freeze({
				skins: () => SKINS.map((skin) => ({ id: skin.id, label: skin.label || localeT(\`skin.\${skin.id}\`), tokens: skin.tokens })),
				defaultLabel: () => localeT("skin.default"),
				current: () => ctx.theme.getTheme().preference,
				onChange: (listener) => ctx.on("theme/change", listener),
				setSkin: (id) => skinInjected(skinBound).setSkin(id),
				Swatch,
				DefaultSwatch,
				styles
			});
`)
replace(/\t*ctx\.slots\.inject\("settings\.dreamSkin\.item", \(\) => ctx\.slots\.register\(\{\n\t*name: "settings\.dreamSkin\.item",\n\t*id: "dream-skin-accent",[\s\S]*?\}, AccentRow\)\);\n/, () => `			// Tavern: no 强调色 row; skins own the colors, and an accent would only be painted over.
`)
replace(/\t\t\tconst raw = readStorage\(ACCENT_KEY\);\n/, () => `			// Tavern: the 强调色 row is gone, so an accent saved earlier no longer applies.
			const raw = null;
`)
writeFileSync(new URL('lib/client.js', root), await integrateInterfaceSkin(client))
