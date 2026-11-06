import type { FileViewerProps } from './service.ts';
/**
 * How many documents' preview positions are remembered. Since v0.25 every
 * visited native tab body stays mounted (the host has no LRU), so this map
 * would otherwise grow with every file the session ever previewed; past the
 * cap the least recently written document is forgotten and its preview opens
 * at the top again — a cosmetic loss, never a wrong document.
 */
export declare const PREVIEW_SCROLL_CAP = 64;
/**
 * Remember one document's preview offset. The write moves the key to the back
 * of the eviction order, so the document forgotten past the cap is the one
 * that has gone longest without a scroll.
 *
 * @param scope - the viewer's scope (its session id is part of the key).
 * @param path - the document's absolute path.
 * @param top - the preview container's `scrollTop`.
 */
export declare function rememberPreviewScroll(scope: {
    sessionId: string;
}, path: string, top: number): void;
/** The remembered offset of one document (0 = none: open it at the top). */
export declare function previewScrollOf(scope: {
    sessionId: string;
}, path: string): number;
export declare function TextEditor(props: FileViewerProps): import("react").JSX.Element;
