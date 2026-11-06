export declare function SandboxStatusBar(props: {
    /** The effective sandbox state (global pref OR the local temporary unlock). */
    sandboxed: boolean;
    /** Whether the sandbox is off due to the LOCAL temporary unlock (shows the restore action). */
    local: boolean;
    /** The red-state explanation (e.g. "the page runs with full GUI privileges"). */
    dangerCopy: string;
    onUnlock: () => void;
    onRestore: () => void;
}): import("react").JSX.Element;
