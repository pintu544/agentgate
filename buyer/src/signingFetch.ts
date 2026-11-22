/**
 * A fetch wrapper that adds fresh Self Agent ID headers to every call.
 *
 * Freshness matters: the seller's verifier has replay protection, and the
 * x402 flow calls fetch twice (the unpaid attempt, then the retry carrying
 * the payment header). Signing per call gives each attempt its own
 * timestamp + signature, so the payment retry is never mistaken for a
 * replay of the first attempt. Headers already present on the init —
 * including the payment header the x402 wrapper adds on retry — are kept.
 */
import type { SelfAgent } from "@selfxyz/agent-sdk";

export interface AttemptRecord {
  method: string;
  url: string;
  status: number;
}

export function createSigningFetch(
  agent: SelfAgent,
  onAttempt?: (attempt: AttemptRecord) => void,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    const selfHeaders = await agent.signRequest(method, url, body);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [name, value] of Object.entries(selfHeaders)) headers.set(name, value);
    const res = await fetch(input, { ...init, headers });
    onAttempt?.({ method, url, status: res.status });
    return res;
  };
}
