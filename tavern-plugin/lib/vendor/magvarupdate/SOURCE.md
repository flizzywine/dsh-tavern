# MagVarUpdate compatibility source

- Upstream: <https://github.com/MagicalAstrogy/MagVarUpdate>
- Pinned commit: `0a730cd4a9b99689d1135a49b542c780b977c24c`
- License: MIT (see `LICENSE`)
- Audited upstream copy: `upstream/` contains the pinned official source, build inputs, license and published `artifact/bundle.js`. The official bundle SHA-256 is `3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f`.
- Runtime asset: `lib/domain/official-mvu-assets.js` verifies the hash before exposing the package-local artifact. Loading this asset does not fetch the MVU Core from a CDN.
- Local integration: `lib/domain/tavern-mvu-runtime.js` is a host-independent JavaScript adaptation of the upstream command, initialization, event and message/swipe semantics. It is not an unmodified upstream bundle and must not be described as full MagVarUpdate compatibility until differential tests prove that level.
- Executable conformance slice: `tests/tavern-mvu-upstream-conformance.test.mjs` freezes the successful add/replace/remove JSON Patch vectors, parser recovery cases, the missing-leading-slash path case, lodash command validation/metadata, canonical `mag_*` lifecycle and zod handoff events, `COMMAND_PARSED` insert/move argument order, quoted-number coercion, and common `pathFix` normalization registered by the pinned implementation and tests. This proves only those named behaviors; it does not upgrade the integration to full MagVarUpdate compatibility.
- JSON Patch fixture source: `json-patch/json-patch-tests` commit `2a928f9044aad35c74e2788d498bcf2c6b91adea`, referenced by the pinned MagVarUpdate repository as `tests/json-patch-tests`.
- Expression evaluator: `mathjs` `12.4.3`, the exact version resolved by the pinned upstream `yarn.lock`; Apache-2.0. dsh-tavern uses the math expression parser and does not copy upstream's `new Function` literal fallback.
