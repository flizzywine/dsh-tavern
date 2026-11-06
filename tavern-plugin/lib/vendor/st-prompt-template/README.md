# ST-Prompt-Template upstream baseline

Pinned upstream: https://github.com/zonde306/ST-Prompt-Template/tree/d6f520d149aba146305b0b781ddd691d449c28d2

Manifest version: 1.17.9 (upstream package.json separately reports 1.17).
License: upstream AGPL-3.0; see upstream/LICENSE. Preserve attribution and corresponding source when distributing a derived build.

`upstream/` contains every upstream tracked source/configuration/documentation/test/library file, byte-for-byte. Only the generated `dist/` directory is excluded; it contains the SillyTavern-targeted bundle, source maps, and editor assets, not DSH host adapters. The complete source includes all five entry modules: handler, command, UI, exports, code editor. DSH builds these sources with the adapters in `host-build/` and loads the resulting complete bundle.

`upstream-lock.json` records the immutable commit and SHA-256 of every retained file. Host changes belong outside upstream/; the build resolves host imports through explicit adapters without editing upstream sources.

Run from repository root:

```
node tavern-plugin/lib/vendor/st-prompt-template/host-build/audit.mjs
```

Requires the project's Node 22 runtime with stripTypeScriptTypes support. The audit checks inventory and content hashes before parsing TypeScript without executing it. It lists static imports, including imports that upstream did not explicitly label as types. The inventory is deliberately not a compatibility score: globals, dynamic loading, DOM selectors, event ordering, and persistence behavior require separate runtime tests. `runtimeReady` remains false.

## Host build and browser verification

The host build now includes all five upstream modules, Faker, xxhash and Monaco with its workers. It resolves SillyTavern imports to `host-build/host.js`; unsupported callback operations throw `PROMPT_TEMPLATE_HOST_UNSUPPORTED`. No host operation is silently acknowledged. The adapter is a per-frame singleton and must never be reused for another session, even after disposal.

Install the exact upstream package-lock in a temporary copy of upstream/ using `npm ci --ignore-scripts --no-audit --no-fund`, then run:

```
node tavern-plugin/lib/vendor/st-prompt-template/host-build/build.mjs /path/to/temporary/upstream /path/to/build-output
node tests/browser/full-prompt-template-browser-smoke.mjs /path/to/build-output
```

The build fails on unresolved imports or compiler warnings and checks the dependency lock. Output includes a hash/size manifest marked `hostIntegrated: true`. Production mounts one dedicated browser instance per selected play session. Worldbook evaluation, opening initial variables, and foreground/background model requests use this upstream instance. Browser fixtures additionally exercise the same artifact with isolated data.

`initializeTemplatePlugin` requires jQuery, lodash, toastr and the Tavern context in its dedicated frame, plus a YAML library, snapshot and named callbacks. It initializes upstream modules once (bypassing only index.ts's jQuery auto-init), exposes the actual official exports, and offers serialized event, command and chat-completion operations. Destroy the owning frame after `dispose` to clear upstream DOM/timer/editor resources. Calls made directly to the official `api` are not serialized by this wrapper.

Authoritative snapshots, native saves, frame ownership/transport and provider requests are connected. Display operations and the user-facing plugin settings interface remain separate integrations; smoke tests do not establish complete plugin parity.

## Native state connection

`connectTemplateSession` connects the browser instance to the production `getFullPromptTemplateState`, `saveFullPromptTemplateState`, and `saveFullPromptTemplateSettings` RPCs. Its `rpc` argument must reject DSH responses with `ok: false`, even when HTTP status is 200. Native save receipts advance the version baseline and reconcile in-flight edits. Settings use the real EjsTemplate namespace. Chat variables, message variables, and template processing flags persist in the native journal; global variables use the versioned Profile store. Message text rewrites use the native history path with version checks.

The packaged minified `host-build/artifact` is served by the production route with manifest integrity checking. It includes upstream settings HTML and third-party license notices. The production executor mounts the plugin and routes final model requests through its generation events. A connected Tavern page is required. This flag records production wiring, not complete SillyTavern host compatibility: reply DOM rendering, extension settings UI, and third-party extension APIs still need separate host integration. Unsupported host callbacks throw explicitly. The previous custom QuickJS/EJS implementation has been removed.

Run `node tests/browser/full-prompt-template-native-browser-smoke.mjs /path/to/artifact` for browser → HTTP → native journal → reopen verification. It creates an isolated temporary profile, without touching a user's existing chat. Its model, macro, regex, and tokenizer services remain deterministic test implementations; it verifies template processing and persistence, not provider HTTP behavior or full regex parity.
