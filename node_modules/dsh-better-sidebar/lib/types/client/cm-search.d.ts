/**
 * Find-in-file for the sidebar editor: CodeMirror's own search extension,
 * wired into every TextEditor view (code and markdown alike, edit and
 * preview mode — the extension lives in the shared base extension list, not
 * in an editable-only branch).
 *
 * Three pieces:
 *  - `search({ top: true })` pins the panel to the TOP of the editor
 *    (CodeMirror's default is the bottom), so it reads like a browser/IDE
 *    find bar and never covers the caret's line.
 *  - `keymap.of(searchKeymap)` binds the upstream default keys: Mod-f opens
 *    the panel, Mod-g / Shift-Mod-g jump next/previous, Mod-Alt-g goes to a
 *    line, Escape closes. The editor's own keymap is registered AFTER this
 *    one, so upstream bindings never shadow it (the only shared key is
 *    Escape, and `closeSearchPanel` returns false when no panel is open —
 *    the editor's `simplifySelection` still runs then).
 *  - the panel's copy comes from the `phrases` facet, which CodeMirror reads
 *    at panel-build time. The facet is part of the EditorState, so a language
 *    switch must reconfigure it — {@link CmSearchPhrases} is that
 *    compartment (the document, history, and keymaps survive).
 *
 * The panel chrome is re-themed with the app's design tokens
 * ({@link cmSearchTheme}): CodeMirror's stock panel paints its own light
 * palette (`&light` selectors resolve as light because the editor theme does
 * not declare `dark`), which would sit as a gray/white box inside a
 * dark-mode sidebar. Only the token-driven chrome is overridden — the match
 * highlight overlays stay CodeMirror's translucent defaults, which read on
 * both schemes.
 */
import { type Extension, type StateEffect } from '@codemirror/state';
/** The search panel chrome on design tokens (no hardcoded colors). */
export declare const cmSearchTheme: Extension;
/**
 * The scheme-independent part of the find-in-file wiring: the top-pinned
 * panel, its theme, and the upstream search keymap. The localized phrases
 * are added separately through {@link CmSearchPhrases} (they are the only
 * piece a language switch reconfigures).
 */
export declare function cmSearchExtensions(): Extension[];
/**
 * A Compartment holding the localized `phrases` facet. Created once per
 * editor view; a language switch dispatches `reconfigure()` on it, which
 * rebuilds the panel copy on its next open without touching the document,
 * undo history, or keymaps.
 */
export declare class CmSearchPhrases {
    private readonly compartment;
    /** `of(...)` payload for EditorState.create. */
    of(): Extension;
    /** Re-resolve the panel copy for the current language. */
    reconfigure(): StateEffect<unknown>;
}
