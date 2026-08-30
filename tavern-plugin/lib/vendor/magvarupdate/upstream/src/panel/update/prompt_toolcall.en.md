# Response format

The response format determines which capabilities the AI provider must support for extra-model
parsing and how reliably MVU can read the variable updates.

- **Chat message:** Offers the widest compatibility and requires no additional provider features.
  Reliability depends on whether the model follows the requested format.
- **Tool call:** Requires tools/function-calling support. It usually reduces interference from
  prose, but unsupported models or reverse proxies may fail or degrade.
- **Structured output:** Requires OpenAI-compatible `response_format.json_schema` support. This is
  usually the best option for JsonPatch variable updates because the response is constrained to
  structured JSON.
- **Structured output (v4 compatible):** For providers, such as dsv4f, that support only
  `response_format.type = json_object`. This mode is available only when the extra-model source is
  **Custom**.

If your provider explicitly supports `response_format.json_schema`, try **Structured output** first.
Otherwise, use **Structured output (v4 compatible)** or **Chat message**. You can also try **Tool
call** when the provider supports tools/function calling.
