import { type RefObject } from 'react';
/**
 * Animate one container's children.
 *
 * @param ref - the container whose DIRECT children are animated. Layout changes
 *   below the direct children (a card's own rows) are not animated — that is the
 *   library's own scope rule, and the page keeps one host per list it wants
 *   animated.
 */
export declare function useAutoAnimateRef<T extends HTMLElement>(ref: RefObject<T | null>): void;
