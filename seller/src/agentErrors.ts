/**
 * Client-safe Self-verification error strings (QA finding C1).
 *
 * The Self SDK's verify() can surface raw upstream errors — RPC failures
 * whose messages embed the full RPC URL, including any API key in it.
 * Those must never reach an unauthenticated caller or the public call
 * log. Only the SDK's fixed, content-free denial strings pass through
 * verbatim; everything else collapses to one generic message. The full
 * detail stays in server-side console logs at the call sites.
 */

export const GENERIC_AGENT_ERROR = "Agent verification unavailable, try again later";

/**
 * Fixed SDK denial strings that carry no URLs, paths or upstream text
 * (verified against @selfxyz/agent-sdk 0.3.1 dist output).
 */
const SAFE_AGENT_ERRORS: ReadonlySet<string> = new Set([
  "Agent not verified on-chain",
  "Agent verification timed out", // this service's own wrapper timeout
  "Agent was not verified by Self — proof provider mismatch",
  "Agent's human did not pass OFAC screening",
  "Agent's human proof has expired",
  "Invalid Ed25519 signature",
  "Invalid signature",
  "Missing agent authentication headers",
  "Missing agent key for Ed25519 verification",
  "Raw request body unavailable for signature verification",
  "Replay detected",
  "Timestamp expired or invalid",
  "Unable to verify proof provider — RPC error",
  GENERIC_AGENT_ERROR,
]);

/** SDK templates whose only interpolation is a bare number. */
const SAFE_AGENT_ERROR_PATTERNS: readonly RegExp[] = [
  /^Rate limit exceeded \(\d+\/(min|hr)\)$/,
  /^Human has \d+ agents \(max \d+\)$/,
];

/**
 * Map any verifier/SDK error to a string that is safe to show an
 * unauthenticated caller and to persist in the public call log.
 * Anything unrecognised — including undefined — becomes the generic
 * message.
 */
export function publicAgentError(raw: string | undefined): string {
  if (
    raw &&
    (SAFE_AGENT_ERRORS.has(raw) ||
      SAFE_AGENT_ERROR_PATTERNS.some((pattern) => pattern.test(raw)))
  ) {
    return raw;
  }
  return GENERIC_AGENT_ERROR;
}
