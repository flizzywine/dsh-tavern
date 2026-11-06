/**
 * Live theme access for surfaces that cannot consume the token colors
 * directly — xterm's palette and CodeMirror's theme extensions need concrete
 * values, but the app's scheme flips at runtime (ui-layout's ThemePresenter
 * projects prefers-color-scheme and the user's choice onto
 * body[data-ds-dark-theme] and html { color-scheme }). This module reads the
 * resolved scheme and token values, and notifies subscribers on flips, so
 * the terminal and the editor re-theme in place instead of freezing in the
 * scheme they happened to be created under.
 */
/** Whether the app shell resolved to the dark scheme.
 *
 * The presenter sets `html { color-scheme }` together with the body palette
 * attribute, so a set color-scheme means the decision is authoritative (an
 * absent attribute is then LIGHT even when the OS prefers dark — the user
 * chose light). Before the presenter has run, fall back to the OS media
 * query as the best guess.
 */
export declare function isDarkScheme(): boolean;
/** One token's computed value on <body> ('' while the theme has not applied). */
export declare function tokenValue(name: string): string;
/** The alpha channel of a computed CSS color, or null when the format is
 *  not parseable (named colors, `color()`… — treated as opaque). Handles
 *  the shapes getComputedStyle actually returns: the rgb()/rgba() and
 *  hsl()/hsla() function forms (comma or space syntax, with or without the
 *  `/ alpha` slot) and the #rgb/#rgba/#rrggbb/#rrggbbaa hex family. */
export declare function colorAlpha(color: string): number | null;
/**
 * A token value that actually PAINTS something — the guard for text
 * surfaces (issue #90). Skin systems routinely set global tokens to
 * `transparent` (glass skins) or translucent glass values (`rgba(…,0.16–0.7)`,
 * e.g. the dsh-web-ui skins) — both are truthy strings, so callers using
 * `|| fallback` never fire and the terminal/editor goes see-through over
 * the skin's backdrop. This returns '' for visually inert values (unset
 * keywords, transparent, and any color below the opacity floor) so the
 * caller's fallback chain engages; effectively opaque values pass through.
 */
export declare function effectiveTokenValue(name: string): string;
/**
 * Subscribe to color-scheme flips (the presenter toggles the body
 * attribute). The callback fires after the attribute changed; re-read the
 * scheme inside it.
 * @returns the disposer.
 */
export declare function subscribeColorScheme(callback: () => void): () => void;
