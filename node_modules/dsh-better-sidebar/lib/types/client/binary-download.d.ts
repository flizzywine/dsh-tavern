/**
 * The "no preview — download instead" pane: shown by the editor host when no
 * viewer can render a file (binary without a registered renderer, or the
 * `binary-download` strategy) and registered as the `binary-download` viewer
 * component so the declarative route and the host fallback share one UI.
 */
import type { ReactNode } from 'react';
import type { SessionScope } from './api.ts';
export declare function BinaryDownload(props: {
    scope: SessionScope;
    path: string;
}): ReactNode;
