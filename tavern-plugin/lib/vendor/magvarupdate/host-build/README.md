# MagVarUpdate dsh-tavern host build

This directory contains the runtime artifact built from the pinned upstream
source in `../upstream/` plus the small, audited Host integration transform in
`prepare-host-build.mjs`.

The deterministic build transform changes build plumbing only:

- pins the upstream build date and commit string for reproducible output;
- keeps browser/UI host globals such as jQuery, lodash and Vue external;
- bundles YAML and Zod so the MVU core does not fetch runtime dependencies;
- bundles every dependency that the published artifact imports from a CDN.
- keeps the MVU uniqueness registry and exported `Mvu` object inside the chat
  sandbox instead of reading or mutating the dsh-tavern parent page.

It does not patch MVU parsing, validation, event order, variable calculation or
chat lifecycle source. The sandbox-local uniqueness change is valid because the
Host enforces exactly one official MVU core per chat sandbox.

Run `./build-host-bundle.sh` to rebuild in a temporary directory and compare the
result with the committed artifact. The build needs registry access; the
committed runtime artifact does not.
