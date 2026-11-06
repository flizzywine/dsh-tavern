/**
 * The read-only paged preview for a file above the editable threshold.
 *
 * Two row shapes share one accumulator ({@link useTextPager}):
 *
 * - `jsonl` — one row per record, collapsed to a one-line summary and
 *   expandable into the host's `JsonTree`. A page is line-aligned, so a page is
 *   exactly a run of whole records.
 * - everything else — one row per line, monospace, no wrapping (horizontal
 *   scroll), which is the log-viewer shape.
 *
 * Scrolling is APPEND-ONLY, like VS Code's output/log view: reaching the bottom
 * pulls the next window and keeps everything already read on screen. There is
 * also an explicit "load all" in the notice bar, for a reader who wants the
 * whole thing up front rather than scroll-hunting for it.
 *
 * The one thing VS Code does not need and this does: a ROW CAP. Its `TextModel`
 * and its view are virtualized, so it can append a gigabyte into the model and
 * still keep the DOM small; this renders real elements. {@link MAX_PREVIEW_ROWS}
 * is therefore where appending stops and the reader is pointed at the download —
 * a visible ceiling beats a frozen tab, and it sits far above any log a person
 * reads in a side panel.
 *
 * Nothing here fetches the document: the file is above the editor's limit
 * precisely because holding it whole is what we are avoiding.
 */
import { type ReactNode } from 'react';
import type { SessionScope } from './api.ts';
/**
 * How many rows the preview will append before it stops and points at the
 * download instead.
 *
 * This is a DOM budget, not a byte budget: the rows are real elements, and one
 * page of short JSONL lines is a few thousand of them. 50k keeps the worst case
 * (a JSONL log read end to end) at a couple of seconds of layout while still
 * covering any file a person reads in a side panel — the 6 MB reference log
 * lands around 35k records, comfortably inside it.
 */
export declare const MAX_PREVIEW_ROWS = 50000;
/**
 * The read-only preview of one over-limit file.
 *
 * @param props.scope - the session scope.
 * @param props.path - the file being previewed.
 * @param props.size - the file's size in bytes (from the read that refused it).
 * @param props.visible - whether the tab is on screen; a parked tab stops reading.
 * @param props.revision - bumped by the host's refresh to restart from page one.
 * @param props.maxRows - row ceiling (defaults to {@link MAX_PREVIEW_ROWS}).
 * @returns the preview.
 */
export declare function LargeFileView(props: {
    scope: SessionScope;
    path: string;
    size: number;
    visible: boolean;
    revision: number;
    maxRows?: number;
}): ReactNode;
