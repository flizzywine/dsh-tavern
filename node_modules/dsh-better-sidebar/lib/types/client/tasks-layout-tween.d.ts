import type { GraphBox, GraphLayout } from './tasks-graph-layout.ts';
/** How long one layout change takes to settle (ms). */
export declare const TWEEN_MS = 220;
/** The tween's easing: fast out of the gate, gently into place (ease-out cubic). */
export declare function easeOut(progress: number): number;
/** One box's geometry, the part a tween interpolates. */
interface BoxGeometry {
    x: number;
    y: number;
    w: number;
    h: number;
}
/**
 * Interpolate one box between two geometries. A box with no `from` (it just
 * entered) stays at its target — the entrance animation owns that moment, and
 * sliding it in from a slot it never had would be a lie.
 *
 * @param from - the previously displayed geometry (undefined = just entered).
 * @param to - the target box.
 * @param progress - 0…1, already eased by the caller.
 */
export declare function tweenBox(from: BoxGeometry | undefined, to: GraphBox, progress: number): GraphBox;
/**
 * The layout as it should be DRAWN right now: the target for a first render and
 * for a reader who asked for less motion, a tweened copy after that.
 *
 * @param layout - the freshly computed layout (the tween's target).
 * @returns boxes to render, plus the target canvas extent (the canvas never
 *   resizes mid-flight: the tween only moves the cards inside it).
 */
export declare function useTweenedLayout(layout: GraphLayout): GraphLayout;
export {};
