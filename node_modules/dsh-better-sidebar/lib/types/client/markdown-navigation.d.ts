/** What a clicked link inside a plugin markdown surface resolves to. */
export type MarkdownAnchorTarget = {
    /** A fragment of the SAME document: scroll the preview's own scroller. */
    kind: 'same-page';
    /** The percent-decoded fragment (`''` for a bare `#` — the document top). */
    fragment: string;
} | {
    /** A markdown file to open in the sidebar. */
    kind: 'file';
    /** Absolute target path (`.`/`..` collapsed), or the cwd-relative spelling
     *  when the surface has no base to resolve against. */
    path: string;
    /** The percent-decoded fragment to land on once the file has rendered. */
    fragment: string;
};
/** Whether a fragment is the host's line destination rather than an anchor. */
export declare function isHostLineFragment(fragment: string): boolean;
/**
 * The FIRST line a host line fragment names (`L24` → 24, `L24-L30` → 24), or
 * undefined when the fragment is a heading anchor.
 *
 * The host hands the same number over as `MarkdownDelegate.openFile`'s
 * `options.line`, so this is the fallback for a caller that only has the
 * destination (and the single place that knows the grammar — the editor has
 * one caret, so a range contributes its start).
 */
export declare function lineOfHostFragment(fragment: string): number | undefined;
/**
 * The GitHub heading slug of one heading's text — the id GitHub itself would
 * give that heading, so the anchors a README's table of contents carries
 * resolve. GitHub's slugger (`github-slugger`) lower-cases ASCII, drops
 * punctuation and symbols, and turns EACH space into its own `-`; it does not
 * trim and does not collapse runs, which is why `## 🛠️ Development & Build`
 * has the id `-development--build` (the leading dash is the space the emoji
 * left behind, the double dash is the removed `&`). Letters, digits and
 * combining marks of ANY script survive, so a Chinese heading keeps its own
 * text as its id.
 *
 * The one deliberate difference from `github-slugger` is where the emoji are
 * removed: GitHub strips them while rendering the heading (to `<img>`), before
 * the slugger ever sees the text, so a slugger run on plain text would keep
 * `🚀` and produce `🚀-安装` instead of GitHub's real `-安装`. This function
 * drops them here, in the same pass, which yields GitHub's actual ids.
 * @param text - the heading's rendered text.
 * @returns the slug (`''` for a heading with no letters or digits at all).
 */
export declare function githubHeadingSlug(text: string): string;
/**
 * Give every heading under `root` a slug `id`, in document order, `-1`/`-2`
 * suffixed on repeats. Authored ids are kept AND reserved first, so a generated
 * slug can never collide with an explicit anchor later in the document; a
 * heading whose text carries no letters or digits is left alone (an empty id
 * resolves nothing). Idempotent: a second pass over the same tree — the
 * mutation re-runs the surface installer depends on — changes nothing.
 * @param root - the surface container (React owns the tree; ids live outside
 *   React's props, so React never removes them).
 */
export declare function assignHeadingIds(root: ParentNode): void;
/**
 * Collapse the explicit anchors GitHub-style READMEs carry (`<a id="x"></a>`):
 * an `<a>` with an id, no child elements and no text is marked `hidden` — out
 * of the way visually, still in the DOM, so `#x` deep links (and the jump
 * helper below) still resolve. Anchors with any content are untouched.
 * @param root - the surface container.
 */
export declare function hideEmptyAnchors(root: ParentNode): void;
/** One post-render pass: heading ids plus empty-anchor collapsing. */
export declare function prepareMarkdownAnchors(root: ParentNode): void;
/**
 * The pure link judge: what a destination inside a plugin markdown surface
 * means, or null to leave it entirely alone.
 *
 * Fed either shape the pipeline produces — a destination as authored (the
 * source rewriter's input) or the decoded destination the host hands
 * `openFile` (where this module's `%23` has already become a `#`).
 * @param destination - the link destination (a raw `href`-style string).
 * @param docPath - the absolute path of the markdown document being rendered;
 *   relative targets resolve against its directory. Absent for prose surfaces.
 * @param cwd - the session workspace root, the base for prose surfaces.
 * @returns the resolved target, or null for every link the plugin does not own.
 */
export declare function markdownAnchorTarget(destination: string, docPath: string | undefined, cwd: string | undefined): MarkdownAnchorTarget | null;
/**
 * Make the host renderer able to SERVE the local links of one markdown text:
 * a claimed `.md`/`.markdown` destination gets its heading fragment carried as
 * `%23`, and every other local destination gets the `?` that keeps it inert.
 *
 * Code regions are masked first (see `maskCodeRegions` — fenced blocks opened
 * by ``` ``` ``` OR `~~~`, and inline code spans), so documentation that
 * demonstrates `[x](./a.md#标题)` is not mutated. Image destinations are left
 * to `rewriteLocalImageUrls` (which must run FIRST: it rewrites the definitions
 * an image uses into absolute media URLs, which this pass then ignores).
 * @param text - the markdown source about to be rendered.
 * @param docPath - the rendered document's absolute path (relative-link base).
 * @param cwd - the session workspace root, the base for prose surfaces.
 * @returns the markdown with local link destinations rewritten in place.
 */
export declare function rewriteLocalMarkdownLinks(text: string, docPath: string | undefined, cwd: string | undefined): string;
/**
 * Land `fragment` inside `container`: open a collapsed `<details>` ancestor
 * (the same courtesy the preview's own outline pays) and scroll the surface's
 * own scroller. A missing target is a silent no-op — a stale link must neither
 * throw nor move the reader.
 * @returns whether the document actually carries the fragment.
 */
export declare function jumpToFragment(container: HTMLElement, fragment: string): boolean;
/**
 * Drop every parked fragment whose TTL ran out.
 *
 * The TTL is already honoured when a fragment is TAKEN, but a fragment parked
 * for a document the reader never opens is never taken — it would sit in the
 * map for the page's lifetime (since v0.25 every visited native tab body stays
 * mounted, and every cross-file link click parks one entry). Sweeping on WRITE
 * is what bounds it: a write is the only event that can add an entry.
 *
 * @returns how many expired entries were dropped.
 */
export declare function sweepPendingAnchors(): number;
/**
 * Park the fragment a cross-file link wants to land on, for the target
 * document's own surface to take once it mounts.
 * @param sessionId - the session both documents live in.
 * @param cwd - that session's workspace root (path resolution).
 * @param path - the target file (absolute, or cwd-relative).
 * @param fragment - the decoded fragment (`''` parks nothing).
 */
export declare function rememberMarkdownAnchor(sessionId: string, cwd: string | undefined, path: string, fragment: string): void;
/**
 * Take (and clear) the fragment parked for one document. The entry is always
 * consumed — a surface that takes it and finds no such heading does not leave
 * it behind for a later, unrelated open.
 * @returns the fragment, or null when nothing (fresh) is parked.
 */
export declare function takeMarkdownAnchor(sessionId: string, cwd: string | undefined, path: string): string | null;
