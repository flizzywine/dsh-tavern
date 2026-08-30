# MagVarUpdate dsh-tavern host build

This directory contains the runtime artifact built from the unmodified pinned
upstream source in `../upstream/`.

The deterministic build transform changes build plumbing only:

- pins the upstream build date and commit string for reproducible output;
- keeps the upstream host globals external;
- bundles every dependency that the published artifact imports from a CDN.

It does not patch MVU parsing, validation, event, variable or lifecycle source.

Run `./build-host-bundle.sh` to rebuild in a temporary directory and compare the
result with the committed artifact. The build needs registry access; the
committed runtime artifact does not.
