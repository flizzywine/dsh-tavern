export interface JsonTransportOptions {
  fetchImpl?: typeof fetch;
  onRetry?: (input: { url: string | URL; error: TypeError }) => void;
}
/** GET/HEAD may retry network failures; writes and aborted requests are never replayed. */
export function createJsonTransport(options?: JsonTransportOptions): <T = unknown>(url: string | URL, init?: RequestInit) => Promise<T>;
