# Private CLI runtime dependency lock

The launcher runs `npm ci` against this manifest and lock inside a staging
runtime. DSH publishes prerelease dependencies as ranges; locking only the
`@deepseek-ai/dsh` entry package can select incompatible or unpublished sibling
versions. Every DSH package in this graph is pinned to the adapted release, and
all downloads retain npm integrity hashes.

When changing the supported host, update the manifest's version, dependency and
DSH overrides together, then regenerate the lock from an empty directory using
`npm install --package-lock-only --ignore-scripts --registry https://registry.npmjs.org`.
Validate a clean install and the actual session patch, browser, edit, regeneration
and rollback flows before shipping. Do not regenerate from an installed linked
profile: its lock may contain machine-local paths.

Unix retains `runtime/lib/node_modules` and `runtime/bin/dsh`; Windows retains
`runtime/node_modules` and `runtime/dsh.cmd`. Existing profile data is separate.
