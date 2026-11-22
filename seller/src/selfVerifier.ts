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
      return { valid: false, error: result.error ?? "Agent not verified on-chain" };
    }
    return {
      valid: true,
      agentAddress: result.agentAddress,
      agentId: result.agentId !== undefined ? result.agentId.toString() : undefined,
    };
  } catch (err) {
    // Deny by default: chain unreadable, RPC failure, timeout — all deny.
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Agent verification unavailable, try again later",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
