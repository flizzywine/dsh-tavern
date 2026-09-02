# Contributing

Bug reports should include the DSH version, Node version, selected image provider & model, and the complete redacted tool error. Never include an API key.

Before opening a pull request, run:

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run pack:check
```

Keep provider adapters in `src/google.ts` and `src/openai-compatible.ts`, shared constants in `src/shared.ts`, DSH registration in `src/index.ts`, and browser presentation in `src/client/index.tsx`.
