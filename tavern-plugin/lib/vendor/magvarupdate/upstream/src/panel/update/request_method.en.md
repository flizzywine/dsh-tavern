# Request method

## How do the methods differ?

### Request sequentially and retry on failure

This works much like asking the AI to regenerate an unsatisfactory story reply:

- Send one request to the AI.
- If the reply contains variable-update commands, apply them.
- Otherwise, keep requesting until the configured number of requests is reached.

### Send multiple requests in parallel

This method sends the configured number of requests **at the same time**:

- Send as many simultaneous requests as the “Number of requests” setting specifies.
- As soon as one reply contains variable-update commands, apply it and cancel the other unfinished
  requests.

This reduces waiting time, but parallel requests consume additional tokens. For models such as
Claude that bill with prompt caching, you can also use the method below.

### Request once, then retry in parallel on failure

Send one request first. If it fails, send multiple requests in parallel.

## When should I use parallel requests?

If your model's requests-per-minute (RPM) limit is high enough, use “Send multiple requests in
parallel” or “Request once, then retry in parallel on failure.”

## Do parallel requests waste many tokens?

Usually not. Extra-model parsing uses only:

- World-book entries whose names contain `[mvu_update]`;
- World-book entries whose names contain neither `[mvu_plot]` nor `[mvu_update]`;
- **Only the last two chat messages**;
- Preset prompts, if a preset is being sent.

Chat history usually accounts for most token usage in SillyTavern, while extra-model parsing reads
only the last two messages. With a sensibly designed character-card world book, batch requests
generally do not waste many tokens.
