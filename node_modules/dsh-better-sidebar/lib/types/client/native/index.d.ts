/**
 * The plugin's content, registered into DSH's native right Sidebar.
 *
 * Every tab the plugin can draw becomes a native tab TYPE plus a BODY:
 *
 * - the `editor` type is both a page (the files window) and a resource
 *   viewer — it claims `dsh-resource://file/**` at the default `extension`
 *   band, which outranks the built-in `text` preview (`fallback`), so a file
 *   the product opens lands in the plugin's editor — EXCEPT the formats
 *   {@link HOST_OWNED_EXTS} hands back to DSH's own previews, which are
 *   strictly better for binary documents (host-side Office→PDF conversion,
 *   a worker-backed spreadsheet table, a zoom viewport);
 * - the built-in `files` page kind is TAKEN OVER by an `extension`
 *   registration of the same kind, so `openTab('files')` draws the plugin's
 *   explorer instead of the built-in tree; the built-in resumes when this
 *   plugin unregisters;
 * - every other descriptor (changes / subagent / side chat / terminal /
 *   browser / diff) becomes a page type of its own.
 *
 * The registrations follow the plugin's registry lifecycle: a descriptor
 * registered later (an external plugin) gets its native type too, and a type
 * the user disabled in the side-card settings is unregistered — so it is
 * absent from the native guide and `openTab` refuses it.
 */
import type { Context } from '../../context-types.ts';
import type { ContextDiagnostics } from '../context-diagnostics.ts';
import type { BetterSidebarService } from '../service.ts';
import type { SidebarStore } from '../state.ts';
import { type NativeTabInfo, type NativeTabParams, type NativeTabRecords } from './tab-adapter.tsx';
/**
 * The plugin-side seed a file-address tab carries.
 *
 * The path comes from the address, and that is also where a `path:line` spec
 * the host's markdown grammar left in it has to come off: DSH reads a `#`-less
 * destination as the file name verbatim, so `[a/b.c](a/b.c:131)` addresses a
 * file called `b.c:131` and the editor reports it missing (#826). The tab
 * TITLE is seeded from the same spec, because the host derives it from the same
 * string and would otherwise label the tab `b.c:131`.
 *
 * The LINE rides along in the same seed. DSH's own `#L131` form already
 * arrives as `navigation.params.line` (the host parses it and sends it down),
 * so seeding it here is what makes both spellings land on the same row — see
 * {@link NativeTabParams.line}. The range end and the column are deliberately
 * dropped: {@link splitTrailingLineSpec} parses them, and a start line is all
 * the editor has anywhere to put a cursor.
 * @param info - the native tab record the body is drawing.
 * @returns the seed, or `undefined` when the tab is not a file address.
 */
export declare function fileParamsOf(info: NativeTabInfo): NativeTabParams | undefined;
/** Everything the registrations need. */
export interface NativeSurfaceDeps {
    readonly ctx: Context;
    readonly store: SidebarStore;
    readonly service: BetterSidebarService;
    /** The shared native tab record registry (the surface writes it too). */
    readonly records: NativeTabRecords;
    /**
     * The activation's optional dsh-context diagnostics controller (see
     * ../context-diagnostics.ts). Forwarded into the tab bodies' injected bag,
     * because a native body renders in the HOST's React tree and cannot read the
     * plugin shell's provider. Omitted = the bodies render without the
     * diagnostics entry points.
     */
    readonly diagnostics?: ContextDiagnostics;
    /**
     * Report a tab-type registration failure (phase label + cause).
     *
     * `ctx.inject`'s callback body and the registry's own subscriber callbacks
     * run OUTSIDE this module's control flow, so a throw from
     * `sidebarRightTabs.register` is swallowed by cordis and the whole native
     * surface stays empty with no symptom beyond a missing guide. Reporting
     * through the client's diagnostic strip (index.tsx `fail`) turns a silent
     * contract break into a visible one — the failure mode observed when DSH
     * 0.1.6-alpha.2 made `SidebarRightGuideEntry.id` required.
     */
    readonly reportFailure?: (phase: string, error: unknown) => void;
}
/**
 * Register the plugin's tabs into the native right Sidebar and keep them in
 * step with the plugin's own registry and settings.
 * @param deps - client context, the plugin store/service, and the records.
 * @returns a disposer unregistering everything.
 */
export declare function registerNativeSurface(deps: NativeSurfaceDeps): () => void;
export type { NativeTabRecords };
