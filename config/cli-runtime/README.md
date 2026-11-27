# Private CLI runtime dependency lock

The launcher and the release startup check run `npm ci` against this manifest
and lock. Every DSH package in this graph must resolve to the adapted release,
and all downloads retain npm integrity hashes.

When changing the CLI host, update `adaptedDshVersion` in
`config/dsh-compatibility.json` and the manifest's version and dependency.
Regenerate the lock from an empty directory using
`npm install --package-lock-only --ignore-scripts --registry https://registry.npmjs.org`.
Validate a clean install and the actual session patch, browser, edit, regeneration
and rollback flows before shipping. Do not regenerate from an installed linked
profile: its lock may contain machine-local paths.

Unix retains `runtime/lib/node_modules` and `runtime/bin/dsh`; Windows retains
`runtime/node_modules` and `runtime/dsh.cmd`. Existing profile data is separate.
