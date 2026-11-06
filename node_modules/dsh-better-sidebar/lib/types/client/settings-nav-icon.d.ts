/**
 * Mark this plugin's row in the DSH settings navigation so its bundled CSS
 * can replace the shell's fallback gear with the Side card glyph.
 *
 * DSH 0.1.x projects only `id`, `order`, and `label` from a
 * `settings.section` registration, then chooses icons inside the settings
 * shell from a closed list of built-in ids. Until that public contract grows
 * an icon field, the plugin identifies only its own localized row after the
 * dialog mounts. The marker owns no shell structure and is removed on fiber
 * disposal, so the adaptation remains HMR-safe.
 *
 * Mutation bursts are coalesced into one sync per animation frame: the
 * observer watches the whole body, so chat streaming would otherwise run the
 * document-wide row query at microtask cadence.
 */
export declare const SETTINGS_NAV_MARKER = "data-dsh-better-sidebar-settings-nav";
/**
 * Keep the marker on the settings-nav button whose visible text is this
 * plugin's current localized section label.
 * @param label - locale-aware label resolver used by the section registration.
 * @returns disposer that disconnects observation and removes owned markers.
 */
export declare function registerSettingsNavIcon(label: () => string): () => void;
