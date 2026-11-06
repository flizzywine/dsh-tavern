import { Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type GitBlameLine, type SessionScope } from './api.ts';
/** The change class of one line, as the gutter paints it. */
export type GitLineKind = 'add' | 'mod' | 'del';
/** The line-number ink of each class (the file tree's own tone mapping:
 *  added/untracked green, modified amber, deleted red). */
export declare const GIT_LINE_CLASS: Record<GitLineKind, string>;
/** Structural class of the bar gutter (also the DOM hook tests query). */
export declare const GIT_BAR_GUTTER_CLASS = "cm-dsh-git-gutter";
/**
 * The changed NEW-side lines of a `git diff` patch, as line number → class.
 *
 * The patch is read through the shared unified-diff engine, so the pairing
 * rules (a rewritten line is one `mod`, not a `del` plus an `add`) are the
 * same ones every other diff surface in the plugin renders. Deletions have no
 * line of their own on the new side: each unpaired deletion is anchored to
 * the line ABOVE the gap — where VS Code draws it too — and to line 1 when
 * the deleted run sits at the head of the file. Context rows contribute
 * nothing, and the anchor never overwrites a line an addition or a rewrite
 * already claimed.
 * @param diffText - `git diff --no-color` output (unified, `-U3`).
 * @returns the changed lines (1-based, worktree side).
 */
export declare function gitLineKinds(diffText: string): Map<number, GitLineKind>;
/** Every line of a file that git does not track yet is an addition. */
export declare function addedLineKinds(lineCount: number): Map<number, GitLineKind>;
/** What the blame tooltip needs from the view that owns it. */
export interface GitGutterHost {
    scope: SessionScope;
    path: string;
}
/** Build the gutter extensions for one view (empty = the feature is off). */
export declare function gitGutterExtensions(host: GitGutterHost | null): Extension[];
/** Push one change set into a live view (no-op without the extensions). */
export declare function applyGitLineKinds(view: EditorView, kinds: ReadonlyMap<number, GitLineKind>): void;
/**
 * A Compartment holding the gutter extensions. Created once per editor view;
 * flipping the setting dispatches `reconfigure(host)`, so the document, undo
 * history, scroll and keymaps survive (host `null` = nothing is installed and
 * no decoration exists at all).
 */
export declare class CmGitGutterCompartment {
    private readonly compartment;
    /** `of(...)` payload for EditorState.create. */
    of(host: GitGutterHost | null): Extension;
    /** Reconfigure for a setting flip (or a new file). */
    reconfigure(host: GitGutterHost | null): ReturnType<Compartment['reconfigure']>;
}
/** Drop the memo of one file (its change set was recomputed or cleared). */
export declare function forgetBlame(sessionId: string, path: string): void;
/** Blame one line, or null when git has no answer (untracked file, no
 *  repository, command failure) — the tooltip then simply never shows. */
export declare function loadBlameLine(scope: SessionScope, path: string, line: number): Promise<GitBlameLine | null>;
/** Everything the gutter needs from the editor component. */
export interface EditorGitGutterOptions {
    /** False for every viewer but `code` / `jsonl`, and when the setting is off. */
    enabled: boolean;
    /**
     * Whether the editor's tab is actually on screen. Native tabs are kept
     * MOUNTED while parked, which is not the same as staying subscribed: a
     * hidden editor must not hold any git work.
     */
    visible: boolean;
    scope: SessionScope;
    path: string;
    /** The loaded text; a reload re-reads the change set. */
    content: string | undefined;
    /** Bumped after a save: the diff changed while the status entry did not. */
    revision: number;
}
/**
 * The changed lines of the open file, from the SHARED git status store (which
 * decides whether the file is modified at all, and whether it is untracked)
 * plus one `git diff HEAD` request per change. Clean files, unknown files and
 * the disabled state all resolve to an empty map — no decoration.
 */
export declare function useEditorGitGutter(options: EditorGitGutterOptions): ReadonlyMap<number, GitLineKind>;
