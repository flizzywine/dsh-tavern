/**
 * Reinterpret an already-absolute path in the namespace of one session.
 *
 * Windows treats `/foo` as rooted on the current drive, so `path.resolve()`
 * turns it into e.g. `C:\\foo`. That is wrong for a session whose cwd is a
 * WSL UNC path: in that namespace `/foo` means the distro's Linux `/foo`.
 * It is equally wrong for a dsh-remote mirror session, whose cwd is a local
 * directory (`...\\.dsh\\remote-workspaces\\<host>\\<workspace>`) standing in
 * for a remote POSIX workspace: there `/srv/app/src/a.ts` means the mirrored
 * file, not `C:\\srv\\app\\src\\a.ts` (which does not exist — the symptom is
 * `ENOENT ... realpath 'C:\\Users\\...'`).
 *
 * Project only those unambiguous combinations onto the matching root; drive
 * paths, UNC paths, ordinary Windows sessions and non-Windows hosts keep
 * their existing semantics.
 *
 * What happens AFTER projection is the caller's business (the old workspace
 * fence is gone; `resolveTarget` only normalizes). The important part for a
 * WSL session is that `/tmp/x` is read as WSL `/tmp/x`, not silently
 * redirected to `C:\\tmp\\x`. For a mirror session a remote path OUTSIDE the
 * mirrored workspace (e.g. `/etc/hosts`) is deliberately left unprojected:
 * it stays slash-rooted, `resolve()` then drive-roots it and the request
 * fails as a missing local file — it is never mapped onto an unrelated file
 * inside the mirror.
 */
export declare function resolveSessionPath(cwd: string, target: string, platform?: NodeJS.Platform): string;
