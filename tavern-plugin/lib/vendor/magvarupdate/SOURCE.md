# MagVarUpdate compatibility source

- Upstream: <https://github.com/MagicalAstrogy/MagVarUpdate>
- Pinned commit: `0a730cd4a9b99689d1135a49b542c780b977c24c`
- License: MIT (see `LICENSE`)
- Local integration: `lib/domain/tavern-mvu-runtime.js` is a host-independent JavaScript adaptation of the upstream command, initialization, event and message/swipe semantics. It is not an unmodified upstream bundle and must not be described as full MagVarUpdate compatibility until differential tests prove that level.
- Executable conformance slice: `tests/tavern-mvu-upstream-conformance.test.mjs` freezes the successful add/replace/remove JSON Patch vectors, parser recovery cases, and the upstream missing-leading-slash path case registered by the pinned tests. This proves only those named behaviors; it does not upgrade the integration to full MagVarUpdate compatibility.
- JSON Patch fixture source: `json-patch/json-patch-tests` commit `2a928f9044aad35c74e2788d498bcf2c6b91adea`, referenced by the pinned MagVarUpdate repository as `tests/json-patch-tests`.
