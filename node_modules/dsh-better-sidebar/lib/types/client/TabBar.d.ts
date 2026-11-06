/**
 * The tab strip of one pane: tabs capped at TAB_MAX_WIDTH (ellipsized),
 * overflow scrolls horizontally, a close button per tab, a four-way split
 * button cluster, and the + menu that opens new tabs (explorer / git). Tabs
 * are draggable; dropping onto another tab inserts before it, dropping on the
 * strip background appends to this pane. Right-clicking a tab opens the tab
 * context menu (close / close others / close to the left / close to the
 * right / close all — every close scoped to this pane — plus reveal the
 * right-clicked tab's file in the OS file manager).
 */
import { type ReactNode } from 'react';
import type { SidebarTab } from './state.ts';
/** One + menu option. */
export interface NewTabOption {
    id: string;
    label: string;
    disabled?: boolean;
    /** Leading icon (Menu row). */
    icon?: ReactNode;
}
/** Drag payload for tab moves (HTML5 DnD dataTransfer). */
export declare const TAB_DRAG_TYPE = "application/x-dsh-tab";
export interface TabDragPayload {
    tabId: string;
    paneId: string;
}
export declare function serializeDrag(payload: TabDragPayload): string;
export declare function parseDrag(raw: string): TabDragPayload | null;
export declare function TabBar(props: {
    paneId: string;
    tabs: SidebarTab[];
    active: string | null;
    onActivate: (tabId: string) => void;
    onClose: (tabId: string) => void;
    onNewTab: (optionId: string) => void;
    newTabOptions: NewTabOption[];
    /** Drop of a tab from any pane: (payload, insertBeforeTabId | null). */
    onDropTab: (payload: TabDragPayload, before: string | null) => void;
    /** Icon resolver for tab labels (reads from the tab descriptor registry). */
    getTabIcon?: (tab: SidebarTab) => ReactNode;
    /** Badge resolver for tab labels (reads the descriptor's `badge`; the
     *  resolver returns the rendered pill or null). */
    getTabBadge?: (tab: SidebarTab) => ReactNode;
    /**
     * Unread resolver for tab labels: the page has something the reader has not
     * looked at yet (a background activation opened it without taking the column
     * over). Rendered as a small dot beside the label; `false`/undefined draws
     * nothing, so a strip with no marks is byte-identical to one that never had
     * the feature.
     */
    isTabUnread?: (tab: SidebarTab) => boolean;
    /**
     * Right-aligned action area resolver for the active tab: returns a
     * ReactNode rendered at the tab strip's right end (between the + button
     * and the panel's close control), or null/undefined for none. Lets a
     * descriptor (e.g. a terminal tab) inject its own toolbar (new / split /
     * restart) directly into the strip instead of a separate header row.
     * Receives the strip's `paneId` alongside the active tab so the resolver
     * can tell WHICH instance's strip it is decorating (split panes each
     * render their own).
     */
    getTabRightActions?: (tab: SidebarTab, paneId: string) => ReactNode;
    /**
     * Reveal one tab's associated file in the OS file manager — the tab
     * context menu's reveal row, fed by the shell with the host's open-in-app
     * capability. The row is disabled for a tab with no associated file (no
     * `path`, e.g. the changes / tasks / side-chat / diff pages) and when the
     * shell passes no resolver at all.
     */
    onRevealInFileManager?: (path: string) => void;
}): import("react").JSX.Element;
