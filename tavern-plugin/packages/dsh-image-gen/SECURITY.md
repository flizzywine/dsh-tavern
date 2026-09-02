# Security Policy

Report vulnerabilities privately to the repository owner through GitHub Security Advisories. Do not open a public issue containing credentials or sensitive response bodies.

The plugin stores provider API keys (Google Gemini, OpenAI, ByteDance Ark) through DSH's write-only `credentials` service. The browser can check whether a key exists but cannot read back the stored plaintext. Generated images are served only by a same-origin JSON POST route and are revalidated by the DSH Attachment service before delivery.
