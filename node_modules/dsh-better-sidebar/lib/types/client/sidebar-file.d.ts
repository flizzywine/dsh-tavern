/**
 * Opening one workspace file in the sidebar — after asking DSH's native tab
 * registry which type owns it.
 *
 * Extracted from the removed turn-tail interception (`intercept.tsx`): DSH
 * 0.1.6-alpha.2 turned `conversation.chat.turnTail` from a `chain` into an
 * additive `list`, so a plugin can no longer REPLACE the built-in
 * deliverables row — the plugin's own produced-files row became a duplicate
 * of a row the host already draws, and was deleted. The file-opening half is
 * the only part still used by the changes tab and the editor host.
 *
 * Naming this plugin's own `editor` type directly used to bypass the native
 * tab registry (#695): a type that explicitly claims a file kind (a `.drawio`
 * canvas registered with `extension` priority and a specific address glob,
 * say) wins the registry's ranking — priority band, matched-pattern length,
 * registration order — yet could never render from these entry points, while
 * the same file opened from the chat (`ctx.sidebarRight.openResource`) did
 * reach it. With the native surface installed, `betterSidebar.openTab({type:
 * 'editor', path})` already resolves through the host's registry (openTab's
 * native branch turns the path seed into a resource address), but that
 * address carries no cwd, and merged-mode opens never went through openTab at
 * all. The probe below closes both gaps: open through the native surface
 * whenever a type other than the editor claims the address, and keep the
 * editor path verbatim for every other file.
 */
import type { Context } from '../context-types.ts';
/**
 * The tab type that would open `address` besides this plugin's own editor.
 *
 * Probing is the whole fix for #695: the registry's ranking — not this
 * plugin's hard-coded `editor` — decides who owns a file address, and the
 * plugin itself already relies on that ranking (its editor holds
 * `dsh-resource://file/**` at the `extension` band, which is why it beats the
 * built-in `text` preview at `fallback` in the first place). For a file no
 * other type claims, the editor IS the best candidate, so the answer is
 * undefined and every caller keeps its previous path verbatim.
 *
 * @param ctx - client context; `ctx.get` is used because the registry is
 * optional (a stripped-down host may not provide it).
 * @param address - the `dsh-resource://file/…` address of the file being opened.
 * @returns the claiming type's kind, or undefined when the editor ranks first
 * (or the probe cannot run — the probe is best-effort by contract).
 */
export declare function claimingNativeKind(ctx: Context, address: string): string | undefined;
/**
 * Open one file through the native surface when a type other than this
 * plugin's editor claims it.
 *
 * The address is built WITH the session cwd (the same spelling the host's
 * conversation file links produce), so a claimed file opened here dedupes
 * against the tab the chat path already opened for the same file.
 *
 * @param ctx - client context (`sidebarRightTabs` for the probe,
 * `sidebarRight` for the open).
 * @param sessionId - the session whose workspace the path resolves in.
 * @param cwd - that session's workspace root, when known.
 * @param path - absolute or session-relative file path.
 * @returns true when the claiming type was handed the file; false leaves the
 * caller on its editor path (unclaimed file, no registry, or no surface).
 */
export declare function openClaimedNativeFile(ctx: Context, sessionId: string, cwd: string | undefined, path: string): boolean;
/**
 * Open a file in the sidebar's editor — unless a native type claims it.
 *
 * Routes through the sidebar service so the editor descriptor's dedupeKey
 * (per-path) applies; the id is path-derived so multiple editors coexist.
 * @param ctx - client context carrying `betterSidebar`.
 * @param sessionId - the session whose cwd resolves a relative path.
 * @param path - absolute or session-relative file path.
 * @param line - the 1-based line a file reference named (`a.c#L131`, #826).
 * Omitted on an ordinary open. It rides the open as a transient navigation:
 * the editor lands on it once (leaving preview, which renders no source
 * lines) and the record forgets it afterwards.
 * @returns nothing.
 */
export declare function openSidebarFile(ctx: Context, sessionId: string, path: string, line?: number): void;
