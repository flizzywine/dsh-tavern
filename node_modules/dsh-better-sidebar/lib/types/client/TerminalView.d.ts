import { type ReactNode } from 'react';
import '@xterm/xterm/css/xterm.css';
import type { Context } from '../context-types.ts';
import type { SessionScope } from './api.ts';
import type { SidebarTab } from './state.ts';
/** The props the bottom terminal view consumes from its tab descriptor. */
export interface TerminalBottomProps {
    ctx: Context;
    scope: SessionScope;
    tab: SidebarTab;
    visible: boolean;
}
/**
 * Render the bottom workbench's terminal tab.
 * @param props - the client context, the tab's session scope and visibility.
 * @returns the terminal screen plus its status/degradation panels.
 */
export declare function TerminalBottomView({ ctx, scope, tab, visible }: TerminalBottomProps): ReactNode;
