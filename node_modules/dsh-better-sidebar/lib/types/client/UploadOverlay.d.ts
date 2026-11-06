/**
 * Full-window upload progress over the files tree: a blurred scrim (same mask
 * token as the repo's Modal primitive) with a card showing the target
 * directory, file-level progress, and a cancel button. Esc cancels too —
 * clicking the scrim does not, so a stray click can never abort an upload.
 * Rendered inside TreePanel (absolute inset-0), so it covers only the file
 * window and never the conversation column.
 */
import { type ReactNode } from 'react';
export declare function UploadOverlay(props: {
    /** Absolute upload directory (the session workspace or a tree directory). */
    dir: string;
    done: number;
    total: number;
    /** Relative path of the file being uploaded ('' when none is in flight). */
    current: string;
    onCancel: () => void;
    /** True while cancellation is in flight (disables the cancel button). */
    cancelling?: boolean;
}): ReactNode;
