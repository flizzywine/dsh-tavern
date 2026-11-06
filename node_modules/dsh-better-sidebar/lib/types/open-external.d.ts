/**
 * External open actions for the file tree's "open with" menu: hand a path to
 * the OS file manager (reveal/select) or launch a URL scheme's registered
 * handler (vscode://, cursor://, zed://, custom schemes).
 *
 * The client runs in a browser / DSH Desktop renderer where a raw `vscode://`
 * navigation is unreliable, so both actions fan out through this host route
 * and spawn the platform opener with an argv array (no shell interpolation).
 * WSL is special: Node reports `linux`, while the actual desktop handlers live
 * on Windows, so its commands cross the interop boundary explicitly.
 */
import { spawn } from 'node:child_process';
/** The two external open actions the route accepts. */
export type OpenExternalAction = 'reveal' | 'url';
/** One platform opener invocation (argv array — never a shell string). */
export interface ExternalCommand {
    command: string;
    args: string[];
}
/** Injectable WSL command seams keep the command builders pure in unit tests. */
export interface WslCommandOptions {
    wsl?: boolean;
    toWindowsPath?: (path: string) => string;
    windowsExecutable?: (path: string) => string;
}
/**
 * Injectable Windows opener NAMES — a test-only seam, never set in production.
 *
 * Pointing them at executables that cannot exist lets the REAL `spawn` drive
 * the whole fallback chain and its failure reporting on a real Windows runtime
 * (see tests/open-external-windows.spec.ts) without launching an application:
 * a binary that does not exist cannot start a browser, an editor or a console
 * window on the runner.
 */
export interface WindowsOpenerOptions {
    /** The `cmd.exe` that runs the `start` branch. */
    cmdExecutable?: string;
    /** The `rundll32.exe` that runs the `url.dll,FileProtocolHandler` branch. */
    rundll32Executable?: string;
}
/** Every command-builder seam: WSL path/executable projection + Windows opener names. */
export type OpenerCommandOptions = WslCommandOptions & WindowsOpenerOptions;
/** Runtime seams used only to make launch/error behavior testable off-host. */
export interface LaunchExternalOptions {
    platform?: NodeJS.Platform;
    wsl?: boolean;
    distroName?: string;
    commandOptions?: Omit<OpenerCommandOptions, 'wsl'>;
    spawn?: typeof spawn;
}
/** True when this Linux host is backed by Windows Subsystem for Linux. */
export declare function isWslRuntime(): boolean;
/** Reveal/select a path in the OS file manager. On plain Linux there is no
 * common select protocol — the containing directory is opened instead.
 * Under WSL the desktop file manager is Windows Explorer. */
export declare function revealCommand(path: string, platform?: NodeJS.Platform, options?: WslCommandOptions): ExternalCommand;
/**
 * The URL openers to try, best first — the Windows chain exists because the
 * `start` route and the rundll32 route fail in disjoint situations (#412:
 * rundll32 alone reported `{ started: true }` while nothing opened).
 *
 * Every entry is an argv array (never a shell string). macOS/Linux keep their
 * single opener and WSL keeps its single absolute-path Windows dispatcher (the
 * registered handlers live on the Windows side of the interop boundary): this
 * chain is a Windows fix, so their behavior is unchanged.
 */
export declare function urlCommands(url: string, platform?: NodeJS.Platform, options?: OpenerCommandOptions): ExternalCommand[];
/** Convert the built-in VSCode-family local-file URL to its Remote-WSL form.
 * A POSIX path produces `scheme://file//...`; keep one leading slash when it
 * moves behind the `wsl+<distro>` authority. Other custom schemes are left
 * alone and merely dispatched through the Windows protocol handler. */
export declare function wslRemoteEditorUrl(url: string, distroName: string): string;
/** Validate a URL-scheme open target: a parseable custom-scheme URL (never
 * http/https — those would only dump the URL into a browser tab). */
export declare function validateExternalUrl(raw: string): string;
/**
 * Launch one external open action detached from the host. Both actions fan out
 * through an ordered candidate chain (one entry on macOS/Linux/Android/WSL, the
 * two Windows URL routes on win32) and reject with the aggregated failure when
 * none of them starts.
 */
export declare function launchExternal(action: OpenExternalAction, value: string, options?: LaunchExternalOptions): Promise<{
    started: true;
}>;
