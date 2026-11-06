import type { Context } from '../context-types.ts';
/** The DOM marker the installer puts on the container it owns (the claim
 *  boundary is the provider scope; this makes the surface inspectable in a
 *  browser and pointable from a spec). */
export declare const MARKDOWN_SURFACE_ATTR = "data-dsh-md-surface";
export interface MarkdownSurfaceOptions {
    /** Client context: the open goes through `openSidebarFile`, the plugin's own
     *  claim-aware editor path (same entry point the file tree and the chat
     *  mentions use). */
    ctx: Context;
    /** The session the markdown renders in — the open scope and the key of the
     *  pending-fragment table. */
    sessionId: string;
    /** The session workspace root, when the caller has a scope. Read live at
     *  click time (a session's cwd may land after the tab does). */
    cwd?: string;
    /** The rendered file's absolute path: relative targets resolve against its
     *  directory. Prose surfaces (transcript, task note) omit it — their
     *  relative targets resolve against the session cwd instead. */
    path?: string;
}
/** What a surface wires into its markup. */
export interface MarkdownSurfaceBinding {
    /** Callback ref for the container that holds the rendered markdown. */
    surfaceRef: (element: HTMLElement | null) => void;
    /** `MarkdownDelegateProvider.openFile` for this surface. */
    openFile: (destination: string, options?: {
        line?: number;
    }) => void;
    /** Rewrite one markdown text before rendering it in this surface. */
    rewrite: (text: string) => string;
}
/**
 * Wire one plugin markdown surface.
 * @param opts - the surface's context, session and rendered document path.
 * @returns the container ref, the delegate handler and the source rewrite.
 */
export declare function useMarkdownSurface(opts: MarkdownSurfaceOptions): MarkdownSurfaceBinding;
