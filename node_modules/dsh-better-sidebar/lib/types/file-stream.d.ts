import type { SidebarHttpResponse } from './context-types.ts';
/**
 * Stream one file into the response with the given headers.
 *
 * The caller keeps ownership of every header except `content-length`, which is
 * derived from `size` here: browsers need it for a download's progress bar,
 * and the routes always have a fresh `stat` at hand.
 *
 * @param path - absolute path of the file to send (already fenced by the caller).
 * @param size - the file's size in bytes, from the same `stat` the caller ran.
 * @param res - the response face.
 * @param headers - status/type/disposition headers, written verbatim.
 * @throws {SidebarError} fs-error when the file cannot be opened — thrown
 *  BEFORE the header commits, so the caller's `writeError` still produces a
 *  proper envelope. After that this function never throws: the response is
 *  already committed and the connection is destroyed instead.
 */
export declare function streamFileToResponse(path: string, size: number, res: SidebarHttpResponse, headers: Record<string, string>): Promise<void>;
