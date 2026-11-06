export interface GraphNode {
    readonly hashFull: string;
    readonly parents: readonly string[];
}
/**
 * The SVG path of one segment — a "rectangular" edge with ONE rounded elbow,
 * never a bare diagonal.
 *
 * WHERE the elbow sits is what keeps every line one colour. An edge that
 * OPENS a line (a merge's second parent) leaves the node horizontally and
 * rounds down into its own new lane. An edge that JOINS a line (a branch
 * ending at its fork) must instead run down its OWN lane and then turn into
 * the surviving lane along the row boundary: rounding into the target lane
 * and dropping there would paint a piece of the leaving branch's colour
 * straight onto the surviving line — the exact "there is still a green
 * stretch on the red main line" defect.
 *
 * A full-row crossing (neither end at a node; the current layout never emits
 * one) bends twice at mid-height. Coordinates stay in the row-fraction space
 * of {@link GraphSegment}; callers scale by the row height.
 */
export declare function edgePath(segment: Pick<GraphSegment, 'fromLane' | 'toLane' | 'fromY' | 'toY' | 'join'>, laneX: (lane: number) => number, rowHeight: number): string;
/** Coordinates are lane indices horizontally and fractions of one row vertically. */
export interface GraphSegment {
    readonly fromLane: number;
    readonly toLane: number;
    readonly fromY: 0 | 0.5;
    readonly toY: 0.5 | 1;
    readonly colorIndex: number;
    /** True when this edge joins a line another child already claimed (a branch
     *  line ENDING at its fork point). A join stub wears the ENDING line's
     *  colour — the node's own — while the surviving line keeps its colour; the
     *  reverse convention would paint the first stretch of every fork in the
     *  colour of the line it joins. An edge that OPENS a parent's new line wears
     *  that new line's colour instead. */
    readonly join: boolean;
    /** The ancestor this line is travelling towards; not necessarily in this page. */
    readonly targetHash: string;
}
export interface GraphLayoutRow {
    readonly hashFull: string;
    readonly lane: number;
    readonly colorIndex: number;
    /** Width needed by this row, including passing lines (not the whole graph). */
    readonly laneCount: number;
    readonly segments: readonly GraphSegment[];
}
/**
 * Lay out a unique, child-before-parent commit prefix, without looking ahead.
 * Render segments before the node, whose center is (lane, 0.5). Scale x by the
 * lane spacing (plus padding), y by row height. A crossing is not a junction;
 * only an endpoint at a commit center represents a connection to that commit.
 *
 * Recompute on the entire concatenated prefix when fetching another page: every
 * previously returned row, including its width and dangling edges, is unchanged.
 * Missing parents deliberately remain reserved through the bottom edge. Do not
 * truncate them based on whether a parent is currently loaded.
 *
 * First-parent continuations inherit their lane/color when possible. Other new
 * branches and disconnected tips get monotonically allocated color indices;
 * callers may reduce these modulo a theme palette. Vacant lanes are reused but
 * live lanes never shift, avoiding accidental connections and pagination jitter.
 *
 * Cost is O(sum of frontier widths + edges), with O(frontier width) working
 * space, excluding output. Width includes vacant slots between live lanes.
 */
export declare function layoutGraph(nodes: readonly GraphNode[]): GraphLayoutRow[];
