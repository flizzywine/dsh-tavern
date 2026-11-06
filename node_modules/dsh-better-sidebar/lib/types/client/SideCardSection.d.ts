import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SidebarPrefs } from '../prefs-shared.ts';
import type { SidebarStore } from './state.ts';
import type { BetterSidebarService, FileViewerDescriptor, SidebarSettingToggle, TabDescriptor } from './service.ts';
/** Injected business face: the shared store (prefs cache) + the sidebar service (registries). */
export interface SideCardSectionInjected {
    store: SidebarStore;
    service: BetterSidebarService;
}
/** Full section props: the runtime share plus the injected face. */
export type SideCardSectionProps = PropsRuntime<'settings.section'> & SideCardSectionInjected;
/**
 * Merge one plugin-owned setting into a pluginSettings map (pure, v0.12.0+).
 * Sequential merges are additive: each call spreads the map it was GIVEN,
 * so building from the latest optimistic map keeps earlier keys intact
 * (two same-tick writes must not drop each other).
 */
export declare function mergePluginSetting(pluginSettings: Record<string, Record<string, unknown>>, descriptorId: string, key: string, value: unknown): Record<string, Record<string, unknown>>;
/**
 * The body of a feature's secondary settings popup: one row (title/desc +
 * control) per declared setting. Switches render the custom switch; text and
 * number rows render a free-form / numeric input committed on blur/Enter
 * (clamped to the declared min/max). Extracted so the rows are testable
 * without opening the Modal (the Modal portal renders only while open).
 */
export declare function FeatureSettingsRows(props: {
    toggles: readonly SidebarSettingToggle[];
    prefs: SidebarPrefs;
    onToggle: (toggle: SidebarSettingToggle, next: boolean) => void;
    /** Commit one text/number row; returns the canonical value the row should
     *  display (clamped for numbers, the current pref when the input is
     *  invalid). Optional: rows with no handler keep their draft. */
    onCommit?: (toggle: SidebarSettingToggle, raw: string) => string;
    /** Commit one select row: the picked option's value (single) or the array
     *  of picked values (`multi: true`). Optional: rows with no handler are
     *  display-only. */
    onSelectValue?: (toggle: SidebarSettingToggle, next: unknown) => void;
    /** Commit one patterns row: the whole string list after an add/remove.
     *  Optional: rows with no handler are display-only. */
    onPatterns?: (toggle: SidebarSettingToggle, next: string[]) => void;
    /** Explicit value source (v0.12.0+): when given, rows read their values
     *  from it instead of the `prefs` face — plugin-owned rows read their
     *  own blob, so a plugin key can never collide with (or silently read)
     *  a host pref of the same name. (Named `valueSource`, not `valueOf`:
     *  the latter collides with the inherited Object.prototype.valueOf.) */
    valueSource?: (key: string) => unknown;
}): import("react").JSX.Element;
/**
 * The secondary settings popup body of one feature (tab or viewer):
 * - the host-prefs `toggles` rows, then the plugin-owned `pluginToggles`
 *   rows (their values live in `pluginSettings[feature.id]`, projected onto
 *   the prefs face so the shared row renderer reads them);
 * - `settings.render` (custom panel) AFTER those rows when declared — the
 *   custom panel is an extension of the row list, not a replacement, so a
 *   feature can keep its declarative rows (e.g. the editor's
 *   open-behavior picker) and still ship a custom configuration area.
 */
export declare function SettingsBody(props: {
    feature: TabDescriptor | FileViewerDescriptor;
    prefs: SidebarPrefs;
    store: SidebarStore;
    service: BetterSidebarService;
    onToggle: (toggle: SidebarSettingToggle, next: boolean) => void;
    onCommit: (toggle: SidebarSettingToggle, raw: string) => string;
    onSelectValue: (toggle: SidebarSettingToggle, next: unknown) => void;
    onPatterns: (toggle: SidebarSettingToggle, next: string[]) => void;
    onPluginToggle: (toggle: SidebarSettingToggle, next: boolean) => void;
    onPluginCommit: (toggle: SidebarSettingToggle, raw: string) => string;
    onPluginSelectValue: (toggle: SidebarSettingToggle, next: unknown) => void;
    onPluginPatterns: (toggle: SidebarSettingToggle, next: string[]) => void;
    onPluginWrite: (key: string, value: unknown) => void;
    onClose: () => void;
}): import("react").JSX.Element | null;
/**
 * Render the Side card preferences section.
 * @param props - composed slot props (runtime share + injected store/service).
 * @returns the section element tree.
 */
export declare function SideCardSection({ store, service }: SideCardSectionProps): import("react").JSX.Element;
