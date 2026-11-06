/**
 * File-upload plumbing for the files window: turn a file picker or a drag-drop
 * into per-file raw-byte uploads through the sidebar's `/sidebar/upload` route.
 *
 * Folders keep their tree in both flows: the picker's `webkitdirectory`
 * selection arrives as Files with `webkitRelativePath` filled, and dropped
 * folders — which never surface in `dataTransfer.files` — are traversed via
 * `webkitGetAsEntry`, so the relative path is preserved for every nested file
 * and the host recreates the tree under the chosen directory. The File is
 * streamed straight into the POST body (no base64 inflation); uploads run
 * sequentially so one slow file cannot starve the others, and each result
 * reports its own outcome (the tree keeps going after a failure). An
 * optional `AbortSignal` stops the queue at the next item boundary and
 * aborts the in-flight request; the host cleans up its temp file when the
 * request stream dies.
 */
import { type SessionScope } from './api.ts';
import type { CopyKey } from './locales.ts';
/** One pending file: the browser File plus the workspace-relative target path. */
export interface UploadItem {
    file: File;
    relativePath: string;
}
/** One settled upload. */
export interface UploadResult {
    relativePath: string;
    ok: boolean;
    path?: string;
    /** Wire error code when the host refused the upload. */
    code?: string;
    /** The host's error message (English wire text; localize via `code`). */
    error?: string;
}
/** Collect a picker selection (webkitdirectory folders carry relative paths). */
export declare function uploadItemsFromFiles(files: FileList | readonly File[]): UploadItem[];
/**
 * Collect a drag-drop payload. Dropped folders do NOT surface in
 * `dataTransfer.files` — they arrive as directory items, so entries are
 * captured via `webkitGetAsEntry` and traversed (draining readEntries
 * batches), keeping each nested file's relative path. MUST be invoked
 * synchronously from the drop handler: the dataTransfer enters protected
 * mode once the event dispatch ends, while the captured entry handles stay
 * readable asynchronously. Falls back to the flat file list when the entry
 * API is unavailable; an entry that fails to read is skipped, not fatal.
 */
export declare function uploadItemsFromDrop(data: DataTransfer | undefined): Promise<UploadItem[]>;
/** How long a success hint stays before fading (failures stay until the next action). */
export declare const UPLOAD_HINT_MS = 3500;
/**
 * One-line upload progress text: 'Uploading into {dir}…' while no file is in
 * flight, then 'Uploading {done}/{total}: {name}' per file. Shared by the tree
 * hint and the full-window upload overlay.
 */
export declare function uploadHintText(done: number, total: number, current: string, dir: string, t: (key: CopyKey, params?: Record<string, string | number>) => string): string;
/**
 * Upload every item into `dir` (absolute, inside the session workspace),
 * sequentially, reporting progress as `(done, total, currentRelativePath)`.
 * Resolves with one result per item — never rejects; `signal.aborted` stops
 * the queue at the next item boundary (completed items stay uploaded).
 */
export declare function uploadToDir(scope: SessionScope, dir: string, items: UploadItem[], onProgress?: (done: number, total: number, current: string) => void, signal?: AbortSignal): Promise<UploadResult[]>;
/** Fold a result list into a one-line status for the tree hint. */
export declare function summarizeResults(results: UploadResult[], t: (key: CopyKey, params?: Record<string, string | number>) => string): string;
