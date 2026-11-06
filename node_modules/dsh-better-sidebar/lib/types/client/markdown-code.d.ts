/**
 * The ONE code-region mask the two markdown source rewriters share
 * (`markdown-images.ts` for image destinations, `markdown-navigation.ts` for
 * link destinations).
 *
 * Both rewrites are regex passes over raw markdown, so anything that LOOKS like
 * a link or an image inside a code region must be left verbatim: a README that
 * documents `[x](./a.md#标题)` or `![i](./p.png)` means to show that syntax, not
 * to have it rewritten. Masking preserves the region byte for byte — the
 * sentinel is a NUL, which cannot appear in markdown source, and the original
 * text goes back in after the pass.
 *
 * What counts as a code region is CommonMark's own rule: an INLINE code span
 * (a backtick run closed by a run of the same length), and a FENCED block — an
 * opening fence of three or more backticks OR three or more tildes, closed by a
 * fence of the same character at least as long as the opener. The fence line
 * itself is masked too (its leading run is what a backtick-span scan would
 * otherwise mistake for a code span), and an unclosed fence runs to the end of
 * the text, exactly as a renderer treats it.
 *
 * Both fence characters matter: `~~~` is a legal fence in CommonMark and in
 * every renderer this plugin draws through, so an image or a link demonstrated
 * inside one is as much an example as one inside ``` ``` ```.
 */
/** The masked text, plus the way back to the original. */
export interface MaskedCodeRegions {
    /** `text` with every code region replaced by a placeholder. */
    masked: string;
    /** Put every masked region back, in place. */
    restore: (text: string) => string;
}
/**
 * Mask the fenced blocks and inline code spans of one markdown text.
 * @param text - the markdown source.
 * @returns the masked text and its restore function.
 */
export declare function maskCodeRegions(text: string): MaskedCodeRegions;
