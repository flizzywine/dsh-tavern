/**
 * Markdown-preview local-image resolution. The shared `MarkdownText` (from
 * @deepseek-ai/dsh-client-ui-primitives) only renders absolute http(s) image
 * URLs — relative links are disabled for chat security — so a local image in
 * a previewed `.md` (`![alt](./img.png)`, an absolute `/cwd/img.png`, or a
 * reference definition) would otherwise fall back to its alt text. This
 * dependency-free helper rewrites those destinations into absolute
 * `/sidebar/file` media URLs, resolved against the injected transport base so
 * a reverse-proxy prefix survives; `MarkdownText` accepts them because they are
 * absolute http(s), and the host media route then serves the bytes.
 */
import type { SessionScope } from './api.ts';
/**
 * Collapse `.`/`..` segments of an absolute local path, preserving its root
 * (POSIX `/`), its Windows drive (`C:\`), or its UNC `\\server\share`
 * prefix. The host's `requireAbsolute` (`path.resolve`) normalizes anyway,
 * but producing a canonical path here keeps the `/sidebar/file` URL clean.
 * Shared with the markdown navigation resolver (`markdown-navigation.ts`),
 * which canonicalizes a claimed link target the same way.
 */
export declare function normalizeLocalPath(path: string): string;
/**
 * Rewrite markdown image destinations that point at local files into
 * absolute `/sidebar/file` media URLs. Relative destinations resolve against
 * the opened file's directory (normalizing `.`/`..` segments); absolute
 * local paths pass through. Remote (http/https/data/mailto) and `#`-anchor
 * destinations are left untouched for `MarkdownText`. Reference-style images
 * (`![x][id]` + `[id]: url`) are covered by rewriting their definition lines.
 *
 * Code regions — inline spans AND fenced blocks, the latter opened by ``` ``` ```
 * OR `~~~` (see `markdown-code.ts`, the mask both source rewriters share) — are
 * masked before rewriting so documentation that demonstrates `![alt](./img.png)`
 * is not mutated into a `/sidebar/file` URL. Reference definitions are only
 * rewritten when their label is actually referenced by an image (collapsed
 * `[![][id]]`, full `![alt][id]`, or shortcut `![]` referencing the next
 * definition) — a plain link `[text][id]` must not have its destination
 * redirected to the media route.
 * @param text - The raw markdown source (inline + reference images).
 * @param scope - The session scope (sessionId + cwd) for the media route.
 * @param filePath - The absolute path of the opened `.md` file.
 * @param baseUrl - The injected transport base (`hostTransportBase()` in the
 * renderers); injected so the core rewrite stays pure and unit-testable.
 * @returns The markdown with local image destinations rewritten in place.
 */
/**
 * Resolve one media destination against the session's media route: local
 * (relative or absolute) paths become absolute `/sidebar/file` URLs, resolved
 * through `baseUrl` so the shared MarkdownText http(s) allowlist accepts them
 * AND a reverse-proxy prefix is preserved, while remote URLs, `#`-anchors and
 * empty destinations are returned untouched. Shared by the markdown image rewriter below and by the
 * preview's raw-HTML sanitizer (`markdown-html.tsx`, which meets the same
 * allowlist when rendering `<img src="./x.png">` inside HTML blocks).
 */
export declare function resolveLocalMediaDest(dest: string, scope: SessionScope, filePath: string, baseUrl: string): string;
export declare function rewriteLocalImageUrls(text: string, scope: SessionScope, filePath: string, baseUrl: string): string;
