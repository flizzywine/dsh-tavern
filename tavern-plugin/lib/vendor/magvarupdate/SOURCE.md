# MagVarUpdate compatibility source

- Upstream: <https://github.com/MagicalAstrogy/MagVarUpdate>
- Pinned commit: `0a730cd4a9b99689d1135a49b542c780b977c24c`
- License: MIT (see `LICENSE`)
- Audited upstream copy: `upstream/` contains the pinned official source, build inputs, license and published `artifact/bundle.js`. The upstream-published bundle SHA-256 is `3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f`.
- Host build: `host-build/` records the build-only patch, deterministic rebuild script and runtime artifact. The patch leaves MVU source semantics unchanged, keeps the expected Tavern globals external, and bundles the seven dependencies that the upstream artifact imports from a CDN. The host bundle SHA-256 is `8333353800b525fb6e01bd433fa429b347676b18fdff9565e751f311673ca378`.
- Runtime asset: `lib/domain/official-mvu-assets.js` verifies the host-build hash before exposing the package-local artifact. Loading this asset does not fetch MVU Core or its module dependencies from a CDN.
- Local integration: the audited upstream bundle runs inside the shared per-chat script sandbox and reaches dsh-tavern state only through `lib/domain/tavern-script-host-adapter.js`. The retired self-written runtime is not part of the production path.
- Integration checks: repository-root `tests/official-mvu-assets.test.mjs` verifies the packaged artifact and its hash; `tests/helper-host-api.test.mjs` exercises the script host bridge. These checks do not establish full upstream behavioral conformance.
- JSON Patch fixture source: `json-patch/json-patch-tests` commit `2a928f9044aad35c74e2788d498bcf2c6b91adea`, referenced by the pinned MagVarUpdate repository as `tests/json-patch-tests`.
- Expression evaluator: `mathjs` `12.4.3`, the exact version resolved by the pinned upstream `yarn.lock`; Apache-2.0. dsh-tavern uses the math expression parser and does not copy upstream's `new Function` literal fallback.
