import type { BetterSidebarService } from './service.ts';
/** Which extension point the modal is adding a plugin for. */
export type PluginKind = 'tab' | 'viewer';
/** The modal body: the GitHub topic button + the recommended plugin list
 *  with per-entry jump/copy buttons (extracted for direct testing). */
export declare function PluginListBody(props: {
    service: BetterSidebarService;
    kind: PluginKind;
}): import("react").JSX.Element;
/** The modal itself (mounted only while open — see the module comment). */
export declare function AddPluginModal(props: {
    service: BetterSidebarService;
    onClose: () => void;
    kind: PluginKind;
}): import("react").JSX.Element;
