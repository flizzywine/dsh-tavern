/**
 * The Tasks canvas's VIEW transforms: where the auto-fit puts the frame, and
 * how the frame travels when that answer changes.
 *
 * Kept pure and separate because the graph itself cannot be measured in a test
 * (jsdom reports every container as 0×0): the centring rule and the glide's
 * interpolation are the two things worth pinning, and both are just arithmetic
 * over numbers the caller already has.
 *
 * The rule the fit follows: scale so the CONTENT box (never the padded canvas)
 * fills the container, never below the readability floor and never above the
 * cap, then centre it on both axes. Centring the padded box is what makes a
 * narrow panel look off-centre, so the padding is subtracted before the scale
 * is chosen and folded back into the offset.
 */
/** One canvas transform: translation in px plus the scale. */
export interface ViewTransform {
    x: number;
    y: number;
    k: number;
}
/** How long the frame takes to glide to a new auto-fit (ms). */
export declare const GLIDE_MS = 220;
/** The inputs of the auto-fit (all px, pre-scale). */
export interface FitInput {
    /** The canvas viewport. */
    containerW: number;
    containerH: number;
    /** The layout's extent, padding included. */
    layoutW: number;
    layoutH: number;
    /** The layout's own padding (breathing room, not content). */
    pad: number;
    /** The smallest content box the fit will measure (one card). */
    minContentW: number;
    minContentH: number;
    /** Breathing room the fit leaves around the content, per axis. */
    margin: number;
    /** The readability floor and the ballooning cap. */
    minScale: number;
    maxScale: number;
}
/**
 * The transform that fits and centres the content, or undefined when the
 * container has no size yet (the sidebar mounts hidden at zero size, so a fit
 * before its first measure must do nothing rather than divide by zero).
 */
export declare function fitTransform(input: FitInput): ViewTransform | undefined;
/**
 * One frame of a glide between two transforms.
 *
 * @param from - where the frame is.
 * @param to - where it is going.
 * @param progress - 0…1, already eased by the caller.
 */
export declare function lerpTransform(from: ViewTransform, to: ViewTransform, progress: number): ViewTransform;
