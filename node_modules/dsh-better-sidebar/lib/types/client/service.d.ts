/**
 * The BetterSidebar client service: a registry that external plugins use
 * to contribute sidebar tab types and file previewers. The service is
 * published to the cordis context as `ctx.betterSidebar` (see
 * {@link ../context-types.ts}); consumers declare it in `inject` and call
 * `registerTab` / `registerFileViewer`, both returning a disposer that
 * cordis auto-invokes on fiber disposal (HMR-safe).
 *
 * Design notes:
 * - The registry is synchronous-snapshot (Map + listener set) so React
 *   can read it through `useSyncExternalStore` without tearing.
 * - `dedupeKey` unifies the three open-tab strategies the builtins used to
 *   hardcode: single-instance (`() => type`), per-path (`tab => tab.path`),
 *   and per-id (`tab => tab.id` for diff tabs whose id is change-derived).
 *   `single: true` is sugar for `dedupeKey: () => id`.
 * - `createTab` lets a descriptor own tab instantiation (the side chat
 *   builtin uses it to mint one `sidechat:<threadId>` tab per thread).
 * - `matchFileViewer` walks descriptors in priority order (desc, stable):
 *   per descriptor it tries `detect` first (when `head` bytes are given),
 *   then `exts`; `exts: []` is a catch-all that matches any path.
 */
import type { ReactNode } from 'react';
import type { Context } from '../context-types.ts';
import { type SidebarSnapshot, type SidebarState, type SidebarStore, type SidebarTab, type TabType } from './state.ts';
import type { SessionScope } from './api.ts';
import type { SidebarPrefs } from '../prefs-shared.ts';
/**
 * Public state vocabulary re-exported for consumers (type-only; the values
 * stay internal). External plugins name these types in their descriptors —
 * e.g. `dedupeKey: (tab: SidebarTab) => tab.id`, `createTab: (state: SidebarState) => …`,
 * or `badge: (…, state: SidebarState) => …`.
 */
export type { SidebarTab, SidebarState, SidebarStore, SidebarSnapshot, SidebarDiffRef, TabType, } from './state.ts';
export type { SessionScope } from './api.ts';
export type { SidebarPrefs } from '../prefs-shared.ts';
/** The row control a declarative setting renders as in the settings popup. */
export type SidebarSettingToggleType = 'switch' | 'text' | 'number' | 'select' | 'patterns';
/** One option of a `type: 'select'` setting row. */
export interface SidebarSettingSelectOption {
    /** The value written to the setting key when this option is picked
     *  (JSON-serializable: string / number / boolean). */
    value: string | number | boolean;
    /** Option title (i18n friendly: string or () => string). */
    title: string | (() => string);
    /** Option description (i18n friendly); rendered under the title in the
     *  icon dropdown. */
    desc?: string | (() => string);
    /** Option icon: when ANY option declares one, the dropdown renders
     *  big-icon option cards and the closed control shows the selected
     *  option's icon too; without icons both are a single line of text. */
    icon?: ReactNode | ((size: number) => ReactNode);
}
/** One declarative setting of a tab/viewer, rendered as a nested row in the
 *  Side card settings page (e.g. the Subagent page's "auto-open when a
 *  subagent appears" switch, or the terminal's custom font rows). `type`
 *  selects the control: 'switch' (default) renders the custom switch,
 *  'text' a free-form input committed on blur/Enter, 'number' a numeric
 *  input clamped to `min`/`max`, 'select' a dropdown over the declared
 *  `options` (single-pick writes the option's value; `multi: true` writes
 *  the array of picked values and defaults to false), 'patterns' an
 *  editable string list (chips with a remove button + an add input) that
 *  commits the whole `string[]` value — the setting key must hold a string
 *  array (the editor's `explorerExclude` glob list uses it). */
export interface SidebarSettingToggle {
    /** The SidebarPrefs field this toggle reads and writes ('autoOpenSubagent'). */
    key: string;
    /** Row title (i18n friendly: string or () => string). */
    title: string | (() => string);
    /** Row description (i18n friendly). */
    desc?: string | (() => string);
    /** Row control type; defaults to 'switch' (backward compatible). */
    type?: SidebarSettingToggleType;
    /** Lower bound for `type: 'number'` rows (clamped on commit). */
    min?: number;
    /** Upper bound for `type: 'number'` rows (clamped on commit). */
    max?: number;
    /** Input placeholder for `type: 'text'` rows. */
    placeholder?: string;
    /** Input placeholder for the add input of `type: 'patterns'` rows. */
    patternsPlaceholder?: string;
    /** Unit suffix rendered after the input (e.g. 'px' for a size row). */
    unit?: string;
    /** Options of a `type: 'select'` row. */
    options?: readonly SidebarSettingSelectOption[];
    /** Whether a `type: 'select'` row allows picking several options (the
     *  stored value is then an array of option values); defaults to false. */
    multi?: boolean;
}
/** Props of a descriptor's custom settings panel (`settings.render`). */
export interface SidebarSettingsRenderProps {
    store: SidebarStore;
    service: BetterSidebarService;
    prefs: SidebarPrefs;
    /** This descriptor's own persisted settings blob (from `pluginSettings[id]`). */
    pluginSettings: Record<string, unknown>;
    /** Persist one plugin-owned setting of this descriptor. */
    updatePluginSetting(key: string, value: unknown): void;
    /** Close the settings popup. */
    close(): void;
}
/** Declarative settings of one registered tab or file viewer. */
export interface SidebarSettingsDeclaration {
    /**
     * Extra settings rows rendered under the feature's own row in the
     * settings page (only while the feature is enabled). Keys must be fields
     * of the host's PrefsSchema (built-ins: 'autoOpenSubagent',
     * 'agentTerminalTools', 'agentOpenTools', 'terminalFontFamily'); unknown
     * keys are dropped by the settings seam.
     */
    toggles?: readonly SidebarSettingToggle[];
    /**
     * Plugin-owned settings rows (v0.12.0+): same row controls as `toggles`
     * (switch/text/number), but the keys are plugin-local and persisted in
     * the sidebar's own prefs document under `pluginSettings[<descriptor id>]`
     * — no host PrefsSchema field needed. Values must be JSON-serializable
     * (the row controls produce strings / numbers / booleans).
     */
    pluginToggles?: readonly SidebarSettingToggle[];
    /**
     * Custom settings panel (v0.12.0+): when given, the gear popup renders
     * this instead of the row lists (`toggles` / `pluginToggles`). Receives
     * the shared store/service, the live prefs, the descriptor's own
     * `pluginSettings` blob, and a persistence helper.
     */
    render?: (props: SidebarSettingsRenderProps) => ReactNode;
}
/** Props every tab component receives (builtins and external alike). */
export interface TabComponentProps {
    ctx: Context;
    store: SidebarStore;
    scope: SessionScope;
    tab: SidebarTab;
    /** Whether this tab is the active one AND the panel is open (live views pause otherwise). */
    visible: boolean;
    /** The explorer's expanded directory set (ExplorerView). */
    expanded?: string[];
    /** The explorer's reveal-highlight set (ExplorerView; "Show in folder" targets). */
    revealed?: string[];
    onToggleDir?: (path: string) => void;
    onReferenceFile?: (path: string, isDir: boolean) => void;
    onOpenFile?: (path: string) => void;
    onOpenDiff?: (tab: SidebarTab) => void;
    onSubagentJump?: (childSessionId: string) => void;
}
/** Describes one kind of sidebar tab (builtins register themselves too). */
export interface TabDescriptor {
    /** Unique id; also the `SidebarTab.type` value (`'explorer'`, `'my-plugin:db'`). */
    id: string;
    title: string | (() => string);
    /**
     * One-line description of what this tab shows, rendered under the title in
     * the host's new-tab list (DSH's native right Sidebar guide page). DSH
     * 0.1.5-rc.1+ renders descriptions only while the guide lists at most 4
     * entries — a longer list drops every description and shows titles alone —
     * and a descriptor that declares none renders the title by itself (the
     * host no longer substitutes a generic fallback, so declare the real
     * purpose of the page). Evaluated at render time, so a function follows
     * the active locale.
     */
    description?: string | (() => string);
    icon?: ReactNode | ((size: number) => ReactNode);
    /** + menu sort order (ascending); default 100. */
    order?: number;
    /** Hide from the + menu (the editor tab is opened by file-open, not by the menu). */
    hidden?: boolean;
    /**
     * Bottom-workbench-only type (v0.26.0+): offered in the plugin's OWN bottom
     * + menu and nowhere else. Without this flag every registered type also
     * becomes a tab type of DSH's native right Sidebar — a guide capsule plus a
     * `kind` the host can open — which is wrong for a page that only makes sense
     * docked under the conversation. (`terminal-bottom` is the case: its host
     * counterpart is DSH's own right-Sidebar `terminal` type, so a second
     * capsule titled "Terminal" is exactly the shadowing
     * `tests/e2e/mount.e2e.ts` pins as absent.)
     *
     * Effects: `openTab` forces this type's landing to the bottom workbench
     * whatever `target` the caller asked for, and the native surface registers
     * neither a type nor a guide entry for it. `hidden` is unrelated — that one
     * hides a type from the + menu while keeping its native tab.
     */
    bottomOnly?: boolean;
    /**
     * + menu disabled predicate (e.g. terminal at capacity). Receives the
     * session scope and the live sidebar state (counts, expansions).
     */
    available?: (ctx: Context, scope: SessionScope, state: SidebarState) => boolean;
    /**
     * Single-instance sugar: `true` is shorthand for `dedupeKey: () => id`
     * (opening the tab focuses an existing one of the same type instead of
     * creating a duplicate). An explicit `dedupeKey` always wins when both
     * are given. Builtins: explorer/git/subagent use `single: true`.
     */
    single?: boolean;
    /**
     * If provided, opening a tab whose `dedupeKey(tab)` matches an existing
     * tab's key focuses the existing one instead of creating a new one.
     * Returning `undefined` means "no dedup — always open a new tab".
     * Builtins: editor uses `tab => tab.path`; diff uses `tab => tab.id`
     * (openDiffTab mints change-derived ids).
     */
    dedupeKey?: (tab: SidebarTab) => string | undefined;
    /**
     * Custom tab creation (minting the `SidebarTab` and any state patches).
     * Return `null` to refuse creation. The side chat builtin uses this to mint
     * one tab per thread and to park a pending thread id in `meta`.
     * When omitted, a default `{ id, type, title }` tab is created.
     */
    createTab?: (state: SidebarState) => {
        tab: SidebarTab;
        patch?: Partial<SidebarState>;
    } | null;
    /**
     * External-link target claim (v0.13.0+): when a GUI external-link click
     * is taken over, the first registered tab whose `urlTarget(url)` returns
     * true is opened with `openTab({ type, url, title: hostname })` — the URL
     * is the whole payload (the tab reads it from `tab.path`). Registration
     * order wins (first claim first served); a disabled tab type is skipped;
     * a throwing predicate is swallowed (console.error, the type is skipped).
     * A click no type claims is NOT taken over at all: it stays with whoever
     * rendered the link (DSH 0.1.7's own chat view routes http(s) by the
     * user's link-opening preference and falls back to a real browser tab).
     * To host more than one URL at a time, mint per-URL ids through `createTab` (the
     * browser builtin's pattern); otherwise the id safety net focuses the
     * existing tab of the same type and the new URL is not applied.
     */
    urlTarget?: (url: URL) => boolean;
    /**
     * Declarative settings shown in the Side card settings page: every
     * registered tab gets an enable/disable switch (icon + title + id), and
     * `settings.toggles` adds nested switches tied to SidebarPrefs fields
     * (e.g. the subagent tab's 'autoOpenSubagent').
     */
    settings?: SidebarSettingsDeclaration;
    /**
     * Tab-strip badge (v0.12.0+): a small pill rendered on the tab next to
     * the icon — a number renders as a count (99+ capped), a string renders
     * as-is, null/undefined hides the badge. Called on every tab-bar render,
     * so keep it cheap; a throw is swallowed (no badge shown).
     */
    badge?: (ctx: Context, scope: SessionScope, state: SidebarState) => string | number | null | undefined;
    /**
     * Right-aligned action area for the tab strip (v0.25.0+). When the tab is
     * active, the returned ReactNode renders at the right end of its pane's
     * tab strip (between the + button and the panel's close control). Lets a
     * descriptor put its toolbar directly in the strip instead of a separate
     * header row below it. Returning null/undefined renders nothing at all
     * (not even an empty wrapper); a throw is swallowed (no actions shown).
     * Called on every tab-strip render, so keep it cheap.
     *
     * `tab` is the open instance this strip is rendering for: with
     * `single: false` and split panes, several instances of one type can be
     * open at once and every pane renders its own strip, so toolbar actions
     * (restart / close / …) must target `tab`, never "the" tab of this type.
     * `paneId` is that strip's pane (compare with `state.activePane` to tell
     * whether the pane is the focused one).
     */
    rightActions?: (ctx: Context, scope: SessionScope, state: SidebarState, tab: SidebarTab, paneId: string) => ReactNode;
    /**
     * Lifecycle callbacks (v0.12.0+). Fired by the SERVICE paths only:
     * `onOpen` when an open actually creates a tab (a dedupe/id-safety-net
     * focus is NOT an open — it fires `onActivate` instead), `onActivate`
     * when a tab is focused (dedupe focus, id-safety-net focus, or the
     * tab-bar activation), `onClose` when a tab is closed through
     * `closeTab`. Builtin-only flows that mutate state directly (the diff
     * split placement, agent-terminal reconcile) never touch external tabs
     * and fire no callbacks. A throwing callback is logged and never breaks
     * the open/close/activate flow.
     */
    onOpen?: (tab: SidebarTab, scope: SessionScope) => void;
    onActivate?: (tab: SidebarTab, scope: SessionScope) => void;
    onClose?: (tab: SidebarTab, scope: SessionScope) => void;
    component: (props: TabComponentProps) => ReactNode;
}
/** How the host loads a file's bytes for one viewer. */
export type FileFetchStrategy = 'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download';
/** Props every file viewer component receives. */
export interface FileViewerProps {
    ctx: Context;
    store: SidebarStore;
    scope: SessionScope;
    path: string;
    title: string;
    /** The matching descriptor's id (`'code'`, `'my-plugin:csv'`). */
    viewerId: string;
    /** The 1-based line the tab's file reference named, when it carried one
     *  (`a/b.c#L131`, `a/b.c:131` — see #826). A viewer that renders text
     *  positions the reader there once, on arrival; every other viewer ignores
     *  it. Absent on an ordinary open. */
    line?: number;
    /** The viewer reports that it has APPLIED the `line` it was handed (or that
     *  the line does not apply to it), and the host stops handing it out: the
     *  line is one navigation, not a mode of the file. The host has to own that
     *  memory — a reload remounts the viewer, so a viewer that only remembers
     *  the line inside itself would receive it again after every refresh (for
     *  markdown/html that means re-forcing the editor open, and the reader could
     *  never return to preview). Optional: absent means "keep handing it out". */
    onLineConsumed?: () => void;
    /** fsRead text content (fetchStrategy='fsRead'). Absent when the file is
     *  above the editable threshold — see {@link largeFile}. */
    content?: string;
    /** The file's size in bytes, as the host measured it for this read. */
    size?: number;
    /**
     * Present when the host refused to hand the document over because the file
     * exceeds the editable threshold. The viewer renders a read-only paged
     * preview instead of an editor: CodeMirror has to hold the whole document in
     * the browser, which is exactly what a file this size makes impossible.
     */
    largeFile?: {
        size: number;
    };
    /** Last-modified time (ms) of the loaded bytes — the built-in text editor's
     *  save baseline (a file that changed on disk since refuses the write).
     *  Absent for viewers/loads that carry no baseline. */
    mtimeMs?: number;
    /** mediaUrl for the path (fetchStrategy='mediaUrl'). */
    mediaUrl?: string;
    /** custom load() return value (fetchStrategy='custom'). */
    customData?: unknown;
    /** Internal (built-in text editor): 'host' asks the viewer to skip its own
     *  toolbar row — the editor host's merged-mode header renders it instead,
     *  fed through the two callbacks below. Viewers that ignore these fields
     *  render exactly as before. */
    toolbar?: 'self' | 'host';
    /** Internal: whether this tab is the ACTIVE one with its panel open. Native
     *  tabs stay mounted while parked, so an over-limit preview must know to
     *  stop reading pages for a tab nobody is looking at. Absent = visible. */
    visible?: boolean;
    /** Internal: the viewer reports its toolbar state (mode/dirty/save). */
    onToolbarState?: (state: EditorToolbarState) => void;
    /** Internal: the viewer registers its toolbar commands on mount (null on
     *  unmount). */
    onToolbarControls?: (controls: EditorToolbarControls | null) => void;
    /** Internal: reload the file from disk (the save-conflict banner's action). */
    onReload?: () => void;
}
/** The toolbar state a text editor reports to the host's merged-mode header. */
export interface EditorToolbarState {
    /** Whether the preview/edit mode toggle applies (markdown / html / jsonl). */
    modes: boolean;
    mode: 'preview' | 'edit';
    dirty: boolean;
    /** Whether saving applies (an editable document was loaded). */
    editable: boolean;
    /** Whether the viewer is showing the read-only paged preview for an
     *  over-limit file. Nothing can be edited or saved in that state, so the
     *  header drops the save button and the viewer's own notice carries the
     *  size and the download escape hatch. */
    largeFile?: boolean;
    saveState: 'idle' | 'saving' | 'saved' | 'failed';
}
/** The commands the host's merged-mode header sends back to the viewer. */
export interface EditorToolbarControls {
    setMode(mode: 'preview' | 'edit'): void;
    save(): void;
}
/** Describes one file previewer (builtins register themselves too). */
export interface FileViewerDescriptor {
    /** Unique id (`'image'`, `'pdf'`, `'my-plugin:csv'`). */
    id: string;
    /** Display name for the settings inventory (falls back to `id` when absent). */
    title?: string | (() => string);
    /** Icon shown in the settings inventory. */
    icon?: ReactNode | ((size: number) => ReactNode);
    /** Lowercase extensions without leading dot (`['png','jpg']`). `[]` = match any (catch-all). */
    exts: readonly string[];
    /** Higher wins; default 0. Builtins use 0; the catch-all `code` viewer uses -100. */
    priority?: number;
    fetchStrategy: FileFetchStrategy;
    /**
     * Content sniff: when `head` bytes are available the descriptor's `detect`
     * is consulted before its `exts` (per-descriptor, in priority order).
     */
    detect?: (path: string, head: Uint8Array) => boolean;
    /** fetchStrategy='custom' loader. `signal` (v0.12.0+) aborts on viewer
     *  teardown / re-match; loaders that ignore it keep working. */
    load?: (path: string, scope: SessionScope, signal?: AbortSignal) => Promise<unknown>;
    /**
     * Declarative settings shown in the Side card settings page: every
     * registered viewer gets an enable/disable switch (icon + title + exts).
     */
    settings?: SidebarSettingsDeclaration;
    component: (props: FileViewerProps) => ReactNode;
}
/**
 * Describes one external file-icon registration (feature `fileIcons`).
 * Registrations override the built-in per-extension glyph map for their
 * extensions; unlike the built-ins (monochrome `currentColor` per the skin
 * contract), a registration's icon may be ANY ReactNode — colored included —
 * and the registering plugin owns how its colors behave across skins.
 */
export interface FileIconDescriptor {
    /** Unique id (`'my-plugin:icons'`). */
    id: string;
    /**
     * Lowercase extensions without leading dot (`['csv','tsv']`). `[]` = the
     * global default (catch-all): it only claims files the built-in glyph map
     * does not cover — registered specifics and built-in glyphs always outrank
     * it. OMITTED = no extension rule at all (a `names`-only registration is
     * NOT a catch-all). Two values are RESERVED for directory rows (never
     * matched against real file extensions): `'folder'` (a closed directory)
     * and `'folder-open'` (an expanded directory) — see `FOLDER_EXT`.
     */
    exts?: readonly string[];
    /**
     * Exact FILE names (basename, case-insensitive — `['package.json',
     * 'Dockerfile']`), the `fileNames` half of an icon theme. Name matches
     * outrank extension matches, so a theme can color `package.json` apart
     * from every other `.json`. Omitted/`[]` = no name rule.
     */
    names?: readonly string[];
    /**
     * Exact DIRECTORY names (basename, case-insensitive — `['node_modules',
     * 'src']`), the `folderNames` half of an icon theme. A name match outranks
     * the reserved `'folder'`/`'folder-open'` exts, and a descriptor with
     * `folderNames` only claims the directories it names (never every folder —
     * that is what the reserved exts are for). Omitted/`[]` = no name rule.
     */
    folderNames?: readonly string[];
    /** Higher wins; default 0. Registered icons always outrank the built-in map. */
    priority?: number;
    /**
     * Size-aware icon factory (the tree and file tabs render at 14 today).
     * `open` is the directory's expanded state for a DIRECTORY row and
     * `undefined` for a file row — a folder icon uses it to pick between the
     * closed and opened glyph.
     */
    icon: (path: string, size: number, open?: boolean) => ReactNode;
}
/**
 * Reserved `exts` values that claim DIRECTORY rows instead of file
 * extensions: `'folder'` matches a closed directory, `'folder-open'` an
 * expanded one (`folderIcon(path, open)` resolves them). They are filtered out of
 * real-extension matching, so a file literally named `x.folder` is NOT
 * claimed by a folder registration.
 */
export declare const FOLDER_EXT: "folder";
export declare const FOLDER_OPEN_EXT: "folder-open";
/** One `openTab` request. */
export interface OpenTabSeed {
    type: string;
    /** Overrides the descriptor's title when given (the editor tab shows the file name). */
    title?: string;
    /**
     * A file path. Meaning follows the type: the `editor` kind (the only one
     * claiming `dsh-resource://file/**`) opens its path seeds as file
     * resources; every other kind treats the path as component state — it
     * rides the navigation params onto the tab record's `path` (v0.19.2+; on
     * v0.19.0/v0.19.1 every path seed was rerouted into a file open).
     */
    path?: string;
    /** A diff reference (the diff tab's content seed). */
    diff?: SidebarTab['diff'];
    /**
     * The 1-based line a file reference named, for the `editor` kind (`#826`).
     * Transient like the record's own `line`: it rides the open as a navigation
     * the editor applies once (leaving preview, which renders no source lines)
     * and the record forgets it right after.
     *
     * It is applied on a CREATE and on a native re-navigation; a store-branch
     * FOCUS of an already-open tab (a host with no native surface) keeps the tab
     * as it is — the same limitation the `diff` seed has.
     */
    line?: SidebarTab['line'];
    /** Explicit tab id (defaults to the type). */
    id?: string;
    /** A URL the tab navigates to on mount (the browser tab's seed). */
    url?: string;
    /** JSON-serializable custom state carried on the minted tab (persisted across reloads; v0.12.0+). */
    meta?: unknown;
    /**
     * Where the open lands. `'right'` (the default) is DSH's right Sidebar —
     * the plugin's content is registered there as native tab types; `'bottom'`
     * is the plugin's own bottom workbench. Only the plugin's own flows pass
     * `'bottom'` (the bottom panel's + menu, the auto-terminal). A descriptor
     * declaring `bottomOnly` is forced there whatever this says: it has no
     * native tab type to land in.
     *
     * `'side'` also means the right Sidebar, but it lands in a SECOND pane
     * there (`preferNewPane`, the host's own split): that is the "open to the
     * side" action, which must not fall back to the bottom workbench a native
     * tab never lives in. A path-less editor seed is the file explorer page, so
     * `'side'` only changes where a path seed lands.
     */
    target?: 'right' | 'bottom' | 'side';
    /**
     * Whether the open may FOCUS what it opens (`target: 'right'` only; the
     * bottom workbench already lands everything in its own pane). Defaults to
     * true — every consumer-facing open means "show me this". A background
     * activation passes `false` so the reader's page survives: the host places
     * the tab without the focus op, and the caller raises the unread dot in its
     * place (see `src/client/sidebar/use-host-feeds.ts`).
     */
    reveal?: boolean;
}
/**
 * The plugin-side seed a native right-Sidebar tab carries in its navigation
 * params (the native surface passes them back on every navigation).
 */
export interface NativeTabParams {
    /** Overrides the descriptor's title for this instance. */
    title?: string;
    /** A file path (the editor window's content seed; component kinds carry their own). */
    path?: string;
    /** A URL the tab navigates to on mount (the browser tab's seed). */
    url?: string;
    /** A diff reference (the diff tab's content seed). */
    diff?: SidebarTab['diff'];
    /** JSON-serializable custom state carried on the synthetic record. */
    meta?: unknown;
}
/**
 * One native tab that carries a file path, as {@link SidebarSurface.pathTabs}
 * reports it. The right column's records live in the native adapter and are
 * invisible to the store, so this is the only handle on its open files.
 */
export interface NativePathTab {
    /** The SEAT session the tab is drawn in (native tab ids restart per session,
     *  so this is what tells two same-numbered tabs apart). */
    sessionId: string;
    /** The session the tab's CONTENT belongs to — the `scope.sessionId` its
     *  editor runs with. */
    scopeSessionId: string;
    /** That session's workspace root, for resolving `path` when the address
     *  stored it workspace-relative (a chat link does). */
    cwd: string | undefined;
    /** The native tab id. */
    id: string;
    /** The path the tab is bound to — a file path, or a browser tab's address
     *  (a url seed is stored on the same field). */
    path: string;
}
/**
 * The plugin's write face over DSH's native right Sidebar.
 *
 * Installed by the client half ({@link ./native/surface.ts}) so the service —
 * and therefore every consumer of `ctx.betterSidebar` — keeps speaking the
 * plugin's own vocabulary while the content lands natively. Without it the
 * service writes into the plugin's own layout (the pre-0.1.5 behavior, which
 * the bottom workbench still uses).
 * @internal Not part of the consumer contract.
 */
export interface SidebarSurface {
    /** Open a page type in one session's native surface. */
    openTab(input: {
        sessionId: string;
        kind: string;
        params: NativeTabParams;
        revealIfOpened: boolean;
        preferNewPane?: boolean;
    }): void;
    /** Open a resource address in one session's native surface. */
    openResource(input: {
        sessionId: string;
        address: string;
        line?: number;
        revealIfOpened: boolean;
        preferNewPane?: boolean;
    }): void;
    /** The file address of one path (the native surface owns the grammar). */
    fileAddress(sessionId: string, cwd: string | undefined, path: string): string;
    /**
     * The plugin tab type one native tab id belongs to, or undefined when this
     * session has no such tab. Used to clear the unread dot when an activation
     * lands on the native surface — the service cannot see the native records
     * itself, and a tab id is not a type.
     */
    tabTypeOf?(sessionId: string, tabId: string): string | undefined;
    /**
     * Every native tab bound to a path. The file tree's rename/delete
     * reconciliation walks BOTH tab spaces — the bottom workbench's splits come
     * from the store, and the right column exists only here. A surface that
     * cannot enumerate them omits this.
     */
    pathTabs?(): NativePathTab[];
    /** Close one native tab; the closed record's type/title/meta, or undefined when the id is not native. */
    close(sessionId: string, tabId: string): {
        type: string;
        title: string;
        meta?: unknown;
    } | undefined;
    /**
     * Patch a native tab's plugin-side record; false when it is not native.
     * `sessionId` (optional) names the seat session the tab lives in: native tab
     * ids restart per session and several sessions' tabs are alive at once
     * (`keepMounted`), so a caller that knows its session should pass it.
     * Omitted, the id resolves against the mounted seat.
     */
    update(tabId: string, patch: {
        title?: string;
        path?: string;
        meta?: unknown;
    }, sessionId?: string): boolean;
    /** Focus a native tab through the host controller; false when it is not native (same `sessionId` rule as `update`). */
    activate(tabId: string, sessionId?: string): boolean;
    /** Whether a tab id belongs to the native surface (same `sessionId` rule as `update`). */
    has(tabId: string, sessionId?: string): boolean;
}
/**
 * The registry service published as `ctx.betterSidebar`.
 */
export interface BetterSidebarService {
    registerTab(descriptor: TabDescriptor): () => void;
    registerFileViewer(descriptor: FileViewerDescriptor): () => void;
    registerFileIcon(descriptor: FileIconDescriptor): () => void;
    getTabs(): readonly TabDescriptor[];
    getFileViewers(): readonly FileViewerDescriptor[];
    getFileIcons(): readonly FileIconDescriptor[];
    /**
     * Find a SPECIFIC registered file icon for a path (priority desc, then
     * registration order): a `names` match first, then an `exts` match.
     * Catch-alls (`exts: []`) and folder registrations (`'folder'`/
     * `'folder-open'`) are not consulted — this answers "did a registration
     * claim this exact name or extension". Consumers should prefer
     * `fileIcon`/`folderIcon`, which run the whole fallback chain.
     */
    matchFileIcon(path: string): FileIconDescriptor | undefined;
    /**
     * Find the registered icon for DIRECTORY rows (priority desc, then
     * registration order): a `folderNames` match on `name` first (pass the
     * directory's basename), then the `'folder'`/`'folder-open'` reserved
     * exts by `open`. Undefined = fall back to the built-in VSCodicons folder
     * glyphs.
     */
    matchFolderIcon(open: boolean, name?: string): FileIconDescriptor | undefined;
    /**
     * The authoritative FILE icon for a path (feature `fileIcons`), running
     * the whole chain with per-factory crash isolation:
     * 1. a specific registered name or extension (priority desc, registration
     *    order),
     * 2. the best registered global default (`exts: []`, priority desc) — an
     *    external plugin that registers a catch-all owns every row the host's
     *    classifier would otherwise draw,
     * 3. the host's own `FileTypeIcon` artwork (feature `fileIcons`, DSH's
     *    classifier and glyphs — the plugin ships no extension table).
     * A throwing factory is logged (console.error) and skipped — the caller
     * always gets a valid ReactNode.
     */
    fileIcon(path: string, size: number): ReactNode;
    /**
     * The authoritative DIRECTORY icon for a tree row: the registered
     * `folderNames`/`'folder'`/`'folder-open'` icon (priority desc), else the
     * built-in `VscFolder`/`VscFolderOpened`. `path` is the directory's own
     * path (a theme may vary icons per directory); `open` reaches the factory
     * so one descriptor can render both states. Same crash isolation as
     * `fileIcon`.
     */
    folderIcon(path: string, open: boolean, size: number): ReactNode;
    /** Find a tab descriptor by id (undefined if not registered). */
    getTab(id: string): TabDescriptor | undefined;
    /**
     * Whether a tab type is enabled in the side card prefs. An absent
     * `tabsEnabled[id]` entry means enabled — only an explicit `false`
     * disables the type (hidden from the + menu, `openTab` refuses, and
     * derived flows gate on it).
     */
    isTabEnabled(id: string): boolean;
    /** Whether a file viewer is enabled (absent `viewersEnabled[id]` = enabled). */
    isViewerEnabled(id: string): boolean;
    /**
     * Find a file viewer for a path (priority desc; detect first, then exts).
     * Disabled viewers are skipped, so files fall through to the next match.
     */
    matchFileViewer(path: string, head?: Uint8Array): FileViewerDescriptor | undefined;
    /**
     * Open a tab (used by external tabs and the + menu). `title` overrides
     * the descriptor's title when given (the editor tab shows the file name);
     * when the descriptor provides `createTab` it mints the tab itself and
     * `title`/`path`/`id` are ignored. `url` lands the tab with its `path`
     * pre-set to the URL (the browser tab's navigation seed; the caller
     * usually pairs it with a hostname `title`). A disabled tab type is a
     * no-op.
     *
     * `scope` (v0.12.0+) targets a specific session: when given, the open
     * lands in THAT session's sidebar state (loading it if it has none yet)
     * without switching the UI's active session; when absent the open lands
     * in the currently active session (the pre-0.12 behavior).
     *
     * Every open lands in the bottom workbench and expands it (the workbench
     * is the plugin's only own surface; the right column is DSH's native
     * Sidebar). An open carrying a `path` or `url` goes through the native
     * surface instead, which never touches this state.
     *
     * Note: `available` gates the + menu's disabled state only — it does NOT
     * refuse `openTab` (only the settings disable switch does).
     */
    openTab(seed: OpenTabSeed, scope?: SessionScope): void;
    /**
     * Close a tab by id (fires descriptor.onClose). An unknown tab id is a
     * strict no-op (no state churn, no callbacks). `scope` (v0.12.0+) rides
     * to the callback (its optional cwd included); absent, the callback gets
     * `{ sessionId }` of the active session.
     */
    closeTab(tabId: string, scope?: SessionScope): void;
    /** Subscribe to registry changes (register/dispose). */
    subscribe(listener: () => void): () => void;
    /** The plugin version this service instance was built from ('0.12.0'). */
    readonly version: string;
    /**
     * Monotonic capability list (v0.12.0+): 'badge' | 'tabLifecycle' |
     * 'updateTab' | 'openFile' | 'targetedOpen' | 'stateSubscription' |
     * 'tabMeta' | 'pluginSettings'. Features are never removed — consumers
     * gate new API usage on membership.
     */
    readonly features: readonly string[];
    /**
     * The current sidebar snapshot: the active session id, its state (panel
     * geometry, open tabs, expansions), and the side card prefs (v0.12.0+).
     * `state`/`sessionId` are undefined until a session becomes active.
     */
    getSnapshot(): SidebarSnapshot;
    /** Subscribe to snapshot changes (session switch, state changes, prefs changes). Returns the disposer. */
    subscribeState(listener: () => void): () => void;
    /**
     * Update the display fields of one open tab (title / path / meta) without
     * re-opening it; a missing tab id is a no-op. `sessionId` names the seat
     * session the tab lives in — native ids restart per session and several
     * sessions' tabs stay mounted at once, so a component that knows its scope
     * should pass it; omitted, a native id resolves against the mounted seat.
     * A **path change is a new open**: the transient landing line a reference
     * carried (#826) is dropped with it, because that line belongs to the
     * navigation that delivered the file — an in-place switch or a rename that
     * kept it would send the next file to the previous file's line.
     */
    updateTab(tabId: string, patch: {
        title?: string;
        path?: string;
        meta?: unknown;
    }, sessionId?: string): void;
    /**
     * Activate an open tab (the tab-bar activation path; fires
     * descriptor.onActivate). An unknown tab id is a strict no-op. `scope`
     * (v0.12.0+) rides to the callback like `closeTab`'s.
     */
    activateTab(tabId: string, scope?: SessionScope): void;
    /** Open a file in the sidebar editor of `scope`'s session (title defaults to the file name). */
    openFile(scope: SessionScope, path: string, title?: string): void;
    /**
     * Resolve one of the plugin's own host routes (`sidebar/api/fs.read`) into
     * an absolute URL the page can fetch even when the GUI is served under a
     * reverse-proxy directory (v0.25.0+; `features` contains 'hostRouteUrl').
     *
     * Never build these URLs with a leading slash yourself: that pins the
     * request to the ORIGIN ROOT, so `/proxy/<port>/sidebar/api/…` leaves the
     * prefix and 404s (and a desktop shell's `dsh-app://` origin is not
     * reachable at all). `path` is taken with or without a leading slash.
     */
    hostRouteUrl(path: string): string;
    /**
     * Retire one session's "new page" dot for a tab type — the reader just
     * looked at that page. A type that is not marked is a strict no-op, so a
     * carrier can call this on every visibility change without churning the
     * store.
     *
     * The mark itself is raised by the plugin's own background activation; this
     * is the retirement half a carrier that renders a marked tab needs. The
     * bottom workbench retires its marks through {@link activateTab} instead
     * (a click there IS an activation), so the native chip is the caller.
     */
    clearUnread(type: TabType, sessionId: string): void;
    /**
     * Install (or clear) the native right-Sidebar write face.
     * @internal Called once by the client half; not part of the consumer API.
     */
    setSurface(surface: SidebarSurface | undefined): void;
    /**
     * Every native tab bound to a path (empty when no native surface is
     * installed).
     * @internal The file tree's rename/delete reconciliation; not part of the
     * consumer API.
     */
    nativePathTabs(): NativePathTab[];
}
/**
 * Find the tab type that claims an intercepted external-link URL (v0.13.0+).
 * Walks the descriptors in REGISTRATION order and returns the first one
 * that declares `urlTarget` and matches `url`; a throwing predicate is
 * swallowed (console.error, type skipped) so one broken plugin can never
 * break the whole link pipeline. The caller passes the ENABLED tab
 * descriptors (enablement is the caller's prefs domain — filter
 * `service.getTabs()` through `tabsEnabled` before matching) and falls
 * back to the built-in browser tab when nothing claims the URL (the
 * browser never declares `urlTarget` itself, so it can never shadow a
 * plugin claim).
 */
export declare function matchUrlTarget(tabs: readonly TabDescriptor[], url: URL): TabDescriptor | undefined;
/**
 * The plugin version this service instance reports. Keep in lockstep with
 * `package.json`'s version — `tests/service.spec.ts` asserts the pair.
 */
export declare const SIDEBAR_SERVICE_VERSION = "0.28.0";
/**
 * Monotonic capability list consumers use to gate new API usage (features
 * are never removed). Each string names a v0.12.0+ capability:
 * - 'badge': TabDescriptor.badge
 * - 'tabLifecycle': TabDescriptor.onOpen/onActivate/onClose
 * - 'updateTab': BetterSidebarService.updateTab
 * - 'openFile': BetterSidebarService.openFile
 * - 'targetedOpen': BetterSidebarService.openTab(seed, scope?)
 * - 'stateSubscription': getSnapshot/subscribeState
 * - 'tabMeta': SidebarTab.meta (seeds, createTab, updateTab, persistence)
 * - 'pluginSettings': SidebarSettingsDeclaration.pluginToggles/render
 * - 'urlTarget' (v0.13.0): TabDescriptor.urlTarget (external-link claims)
 * - 'settingSelect': SidebarSettingToggle type 'select' (options/multi)
 * - 'fileIcons' (v0.19.0): registerFileIcon/getFileIcons/matchFileIcon —
 *   external file-tree icons overriding the built-in glyphs, matched by
 *   extension (`exts`), exact file name (`names`), or directory name
 *   (`folderNames`).
 * - 'rightActions' (v0.25.0): TabDescriptor.rightActions — the active tab's
 *   right-aligned action area rendered at the tab strip's right end.
 * - 'settingPatterns': SidebarSettingToggle type 'patterns' (editable
 *   string-list row, committed as one string[] value).
 *
 * v0.19.0 REMOVED 'floatWindows': the free-window feature is gone (DSH 0.1.5
 * owns the right column, so the plugin keeps only its bottom workbench).
 * Consumers must not gate on it any more.
 */
export declare const SIDEBAR_FEATURES: readonly ["badge", "tabLifecycle", "updateTab", "openFile", "targetedOpen", "stateSubscription", "tabMeta", "pluginSettings", "urlTarget", "settingSelect", "fileIcons", "rightActions", "settingPatterns", "hostRouteUrl"];
/**
 * Create one BetterSidebar service bound to a store. The service owns the
 * tab/viewer registries (Map + listener set) and proxies openTab/closeTab
 * to the store's reducer. One instance per client plugin activation.
 */
export declare function createBetterSidebarService(store: SidebarStore): BetterSidebarService;
