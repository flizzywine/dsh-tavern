# dsh-presentation-protocol

Inert host/browser presentation contracts for the P0 extraction. This is an
ordinary source library, not a Cordis plugin. There is no `apply`, client roster,
service registration, filesystem, model call, media fetch or persistent state.
It needs no build or installed dependency. Node and the browser execute the same
moved reducer bodies; Tavern's source assembler includes the CJS browser sources
from the dedicated `@include-protocol` root.

## Exports

- `./config`: `CONFIG_OWNER_PATHS`, `configFieldOwner`,
  `validateCurrentStageConfig`, and the moved `normalizeStageBudget` primitive.
  Validation never normalizes old documents or grants write authorization.
- `./playback`: version-3 record/index validation and JSON codecs,
  `playbackDigest`, `playbackEventId`, `compactPlaybackRecord`, `seekPlayback`,
  `playbackEventsBetween`, and moved incremental-state/lighting/pacing functions.
- `./figure`: unchanged `figure*`, calibration validation, and sizing math.
- `./soundscape`: unchanged tag validation, snapshot/replay and mix planning.
  Mix plans use caller-supplied descriptors; the library never resolves a lease,
  reads a catalogue, loads an audio object or performs network access.
- `.` exposes the four namespaces; explicit versioned DTO declarations are in
  `src/types`. Internal source modules are not package subpath exports.

## Record Contract

`encodePlaybackRecord` returns `{json, recordDigest}` asynchronously. JSON is
canonical (sorted object keys), consecutive duplicate states compact, and the
record digest is SHA-256 via standard Web Crypto. `decodePlaybackRecord` requires
an expected target, publication digest and record digest. Unknown versions fail
with `MIGRATION_REQUIRED`; mismatched content and targets fail rather than being
reinterpreted. No DSL, legacy storage reader, lazy converter or I/O is hidden in
the codec. Index keys are inert identities, not paths or browser URLs.

`seekPlayback(record, paragraph)` returns only a detached state. It never returns
or dispatches one-shot events. Forward playback explicitly selects events using
`playbackEventsBetween(record, from, through)`. Event IDs are publication digest,
paragraph and same-paragraph ordinal, preserving stable operation order.

Existing entry-oriented reducer signatures remain unchanged during P0, including
Tavern's current presentation semantics. This does not activate v3 persistence or
change core message receipts. Director transaction/DSL ownership stays outside
this package. Frozen geometry/soundscape inputs and current full-state record
fixtures are shared with later offline tooling, not sourced from current assets
when replaying history.

## Verification

From the repository root:

```powershell
node --test tavern-plugin/packages/dsh-presentation-protocol/tests/*.test.mjs
node bin/build-tavern-client.mjs --check
```

Run the repository's regression gate as well when changing consumers of these
contracts. The package tests do not require a running host.
