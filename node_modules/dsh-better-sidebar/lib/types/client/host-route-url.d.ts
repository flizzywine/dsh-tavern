/**
 * Resolve one host route against the injected base. Leading slashes are
 * stripped on purpose — keeping one would discard a reverse-proxy prefix.
 * @param path - The route, with or without a leading slash
 * (`sidebar/api/fs.tree`, `sidebar/ws/fs-watch`).
 * @param baseUrl - Override for the shared transport base; specs pass a static
 * prefix so resolution stays pure.
 * @returns The absolute route URL (the base's origin + any prefix included).
 */
export declare function hostRouteUrl(path: string, baseUrl?: string): URL;
/** {@link hostRouteUrl} with the `ws:`/`wss:` scheme `WebSocket` requires. */
export declare function hostWebSocketUrl(path: string, baseUrl?: string): URL;
