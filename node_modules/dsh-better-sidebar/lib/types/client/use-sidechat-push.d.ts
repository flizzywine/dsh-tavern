/** What the view hands the hook. */
export interface SidechatPushOptions {
    /** Threads to watch; an empty list closes the socket entirely. */
    threadIds: readonly string[];
    /**
     * Whether the owning tab is on screen. Defaults to true; a parked tab has
     * no socket, and coming back re-subscribes and re-pulls once.
     */
    visible?: boolean;
    /**
     * A watched thread whose transcript should be re-pulled.
     * @param threadId - the thread the host named, always one of `threadIds`.
     */
    onInvalidate: (threadId: string) => void;
}
/**
 * Follow the host's staleness notices for the given side-chat threads.
 * @param options - the watched ids, the tab's visibility, and the invalidation callback.
 */
export declare function useSidechatPush(options: SidechatPushOptions): void;
