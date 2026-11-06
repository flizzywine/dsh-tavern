# MagVarUpdate dsh-tavern host build

This directory contains the runtime artifact built from the pinned upstream
source in `../upstream/` plus the small, audited Host integration transform in
`prepare-host-build.mjs`.

The deterministic host build applies these adaptations:

- pins the upstream build date and commit string for reproducible output;
- keeps browser/UI host globals such as jQuery, lodash and Vue external;
- bundles YAML and Zod so the MVU core does not fetch runtime dependencies;
- bundles every dependency that the published artifact imports from a CDN.
- keeps the MVU uniqueness registry and exported `Mvu` object inside the chat
  sandbox instead of reading or mutating the dsh-tavern parent page.
- pauses chat-level initialization after the official `Mvu` global is available
  until the Host has loaded the card companion scripts, so their official event
  handlers participate in opening initialization.

- removes the 3-second MESSAGE_RECEIVED throttle: host events are already serialized, and each settlement must await its own handler rather than receive the previous event's Promise.

- uses the complete current-floor snapshot when no earlier floor has valid MVU
  data, so resumed/imported games can settle without rewriting historical floors.

- disables ST JSONL variable compaction, its legacy prompt, manual cleanup button,
  and enable controls; historical snapshots remain available for rollback and
  imported-chat restoration. Existing cleanup settings do not trigger writes.

- searches prior valid variable snapshots backward without first copying the
  entire historical prefix; the predicate and returned absolute index are unchanged.
- limits restoration eligibility checks to the existing recent-floor threshold;
  missing snapshots in that range still run the original restoration logic.

- derives the schema from an opening `<initvar>` block and strips its `$meta` /
  `$arrayMeta` metadata, as upstream already does for lorebook `[initvar]` data.

It does not otherwise patch MVU parsing, validation or variable calculation.
The sandbox-local uniqueness change is valid because the Host enforces exactly
one official MVU core per chat sandbox; the readiness barrier only restores the
shared-page registration order before official chat initialization starts.

Run `./build-host-bundle.sh` to rebuild in a temporary directory and compare the
result with the committed artifact. The build needs registry access; the
committed runtime artifact does not.
