/**
 * The UI half of the optional dsh-context diagnostics: three entry points into
 * ONE conversation's "Context" view (an agent node's detail card, a background
 * job's output window, the session header's utilities row) and the frame-wide
 * error alert they share.
 *
 * Availability comes from the controller (./context-diagnostics.ts), never from
 * a guess here: it re-proves the optional runtime faces and answers `available`
 * (the tab type AND its keyed body), and its single `busy` flag disables all
 * three entry points for the duration of an open.
 *
 * The controller is threaded PER ACTIVATION — created in ./index.tsx, handed to
 * the host's two slots by closure, to the plugin's tree through the provider,
 * and to the native bodies through the native surface's deps bag. No
 * module-level store on purpose: two activations must never share one, and a
 * body unmounting must never clear another entry point's controller.
 */
import { type ReactNode } from 'react';
import type { Context, SidebarSubagentAddress } from '../context-types.ts';
import { type ContextDiagnosticTarget, type ContextDiagnostics } from './context-diagnostics.ts';
/** The entry id both slot registrations use. */
export declare const HEADER_ENTRY_ID = "dsh-better-sidebar:context-diagnostics";
/** The three entry points, as the e2e lane tells them apart. */
export type DiagnosticsEntryKind = 'session' | 'agent' | 'job';
/** Testid of an entry point's control; ABSENT while the control is not offered. */
export declare const DIAGNOSTICS_ENTRY_ATTR = "data-dsh-ctx-entry";
/** Testid of the frame-wide alert. */
export declare const DIAGNOSTICS_ALERT_ATTR = "data-dsh-ctx-alert";
/** Thread one activation's controller into a subtree (shell, native tab body). */
export declare function ContextDiagnosticsHost(props: {
    controller?: ContextDiagnostics;
    children?: ReactNode;
}): ReactNode;
/**
 * One entry point's control, shared so the three surfaces cannot drift apart:
 * the gate (capability available AND a resolved target), the single-open
 * disable, and the e2e handle.
 */
export declare function ContextDiagnosticsButton(props: {
    kind: DiagnosticsEntryKind;
    /** `undefined` = this surface has nothing addressable to offer. */
    target: ContextDiagnosticTarget | undefined;
    /** The host glyph's size (the header uses 14, the floating window 12). */
    iconSize: number;
    /** The caller's box class, when the glyph must not take row width. */
    className?: string;
    /** Dismiss source UI after dispatch; the controller owns the pending request. */
    onNavigate?(): void;
}): ReactNode;
/**
 * The ONE error alert (`shell.overlay`), dismissed by the controller's own
 * `dismissError()` — never a timer. Gated on the ERROR only, not on
 * `available`: an open already in flight when the capability went away must
 * still report why it failed.
 */
export declare function ContextDiagnosticsAlert(props: {
    controller: ContextDiagnostics;
}): ReactNode;
/**
 * Contribute the header control and the frame-wide alert. Both ride
 * `slots.inject`: neither declaration is guaranteed to be on the ledger at
 * activation (the header and the frame come from other entries), and the
 * callback re-runs if one collapses and is re-declared.
 * @param ctx - the client context (slots + the native right column probe).
 * @param controller - the controller of this activation.
 * @returns a disposer unregistering both entries.
 */
export declare function registerContextDiagnosticsUI(ctx: Context, controller: ContextDiagnostics): () => void;
/** The activation's diagnostics controller (one per client activation). */
export declare function createContextDiagnosticsHost(ctx: Context): ContextDiagnostics;
/** A tree node's navigable address, when the tree really has one: the ROOT node
 *  carries none (it IS the main session) and is addressed by its own id, and an
 *  incomplete pair (a stale parent, a synthesized member) yields no control. */
export declare function diagnosticAddressOf(nodeId: string, address: SidebarSubagentAddress | undefined): SidebarSubagentAddress | undefined;
