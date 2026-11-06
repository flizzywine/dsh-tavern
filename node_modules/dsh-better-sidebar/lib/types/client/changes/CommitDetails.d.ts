import { type GraphEntry } from './GitGraphSection.tsx';
export interface CommitDetailsProps {
    /** The graph page's entry for the selected commit. */
    entry: GraphEntry;
    /** The graph's remote ref names, so `origin/main`-style pills read muted;
     *  only the lens holds the branch inventory this set is derived from. */
    remotes?: ReadonlySet<string>;
    /** The palette slot of the commit's lane, so the card's pills wear the same
     *  colour as the graph row the commit sits on. */
    slot?: number;
}
/**
 * `git log %B` is the RAW body: its first line is the very subject the card
 * already shows as its title, so the markdown block renders only what follows
 * (the split GitHub's commit page makes). When the first line is not the
 * subject — a hand-written message whose `%s` was folded differently — the
 * whole body renders rather than silently dropping a line.
 */
export declare function messageBodyOf(entry: GraphEntry): string;
export declare function CommitDetails({ entry, remotes, slot }: CommitDetailsProps): import("react").JSX.Element;
