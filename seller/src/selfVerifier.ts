/**
 * Module boundary around the Self Agent ID SDK (`@selfxyz/agent-sdk`).
 *
 * Everything else in the service talks to `verifyAgentRequest` only, so
 * tests can substitute this module wholesale. The wrapper is deny-by-
 * default: SDK errors and timeouts are converted into a failed result
 * with a machine-readable error string — it never throws to callers.
 *
 * Protocol (spec/research.md §1): the agent signs
 * keccak256(timestamp + METHOD + pathWithQuery + keccak256(body)) and
 * sends it in `x-self-agent-signature` / `x-self-agent-timestamp` /
 * `x-self-agent-address` headers. The verifier needs the EXACT raw body
 * bytes, which app.ts preserves as `req.rawBody`.
 */
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import type { SellerConfig } from "./config.js";
import { publicAgentError } from "./agentErrors.js";

/**
 * Per-agent verification rate limit (QA finding W2). The SDK enforces
 * it as an in-memory sliding window keyed by agent; generous enough
 * that demo traffic (a handful of calls) never notices it.
 */
const VERIFY_RATE_LIMIT_PER_MINUTE = 30;

export interface AgentVerifyInput {
  signature: string;
  timestamp: string;
  method: string;
  /** Path + query string of the request (no host). */
  url: string;
  /** Exact raw request body as a string ("" when there is no body). */
  body: string;
  keytype?: string;
  agentKey?: string;
}

export interface AgentVerifyResult {
  valid: boolean;
  agentAddress?: string;
  agentId?: string;
  error?: string;
}

let cached: { key: string; verifier: SelfAgentVerifier } | null = null;

function getVerifier(cfg: SellerConfig): SelfAgentVerifier {
  const key = `${cfg.selfNetwork}|${cfg.selfRpcUrl ?? ""}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      verifier: SelfAgentVerifier.fromConfig({
        network: cfg.selfNetwork,
        // The registry itself allows up to 10 agents per human on Celo
        // mainnet; the SDK default of 1 would falsely deny later agents
        // registered by the same human (research.md §1).
        sybilLimit: 10,
        rateLimit: { perMinute: VERIFY_RATE_LIMIT_PER_MINUTE },
        ...(cfg.selfRpcUrl ? { rpcUrl: cfg.selfRpcUrl } : {}),
      }),
    };
  }
  return cached.verifier;
}

export async function verifyAgentRequest(
  cfg: SellerConfig,
  input: AgentVerifyInput,
): Promise<AgentVerifyResult> {
  const verifier = getVerifier(cfg);
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      verifier.verify({
        signature: input.signature,
        timestamp: input.timestamp,
        method: input.method,
        url: input.url,
        body: input.body,
        keytype: input.keytype,
        agentKey: input.agentKey,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Agent verification timed out")),
          cfg.verifyTimeoutMs,
        );
      }),
    ]);
    if (!result.valid) {
      // C1: only fixed, content-free denial strings may reach the
      // caller / public log; anything else (e.g. an RPC error embedding
      // a credentialed URL) collapses to the generic message, with the
      // original kept server-side only.
      const rawError = result.error ?? "Agent not verified on-chain";
      const safeError = publicAgentError(rawError);
      if (safeError !== rawError) {
        console.error("[agentgate] Self verification denied; detail withheld:", rawError);
      }
      return { valid: false, error: safeError };
    }
    return {
      valid: true,
      agentAddress: result.agentAddress,
      agentId: result.agentId !== undefined ? result.agentId.toString() : undefined,
    };
  } catch (err) {
    // Deny by default: chain unreadable, RPC failure, timeout — all
    // deny. C1: the raw message may embed a credentialed RPC URL, so it
    // is logged server-side only and the caller gets the sanitised form
    // (our own timeout string is on the safe list and passes through).
    console.error("[agentgate] Self verification error", err);
    return {
      valid: false,
      error: publicAgentError(err instanceof Error ? err.message : undefined),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
