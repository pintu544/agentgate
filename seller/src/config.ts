/**
 * Seller configuration, read from environment only. No secrets in code.
 *
 * - EXA_API_KEY: snapshot generation. Without it the snapshot handler
 *   answers 503 (the deny/payment gates still work).
 * - X402_API_KEY: Celo x402 facilitator key (created by the project owner
 *   at x402.celo.org — Slice 1 task T1.4). The payment middleware is only
 *   mounted when this AND SELLER_PAY_TO are present.
 * - SELLER_PAY_TO: seller wallet address that receives x402 settlements.
 */
export interface SellerConfig {
  exaApiKey?: string;
  x402ApiKey?: string;
  sellerPayTo?: string;
  /** Self Agent ID network: "mainnet" (default) or "testnet". */
  selfNetwork: "mainnet" | "testnet";
  /** Optional RPC override for the Self verifier (e.g. Chainstack). */
  selfRpcUrl?: string;
  /** Milliseconds before a Self verification attempt is abandoned (deny). */
  verifyTimeoutMs: number;
  /** Append-only call log file (JSONL). Defaults to seller/data/calls.jsonl. */
  callLogPath?: string;
  /** Whether the x402 middleware syncs with the facilitator on first use. */
  paymentSyncOnStart: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SellerConfig {
  const timeout = Number(env.SELF_VERIFY_TIMEOUT_MS ?? "15000");
  return {
    exaApiKey: env.EXA_API_KEY || undefined,
    x402ApiKey: env.X402_API_KEY || undefined,
    sellerPayTo: env.SELLER_PAY_TO || undefined,
    selfNetwork: env.SELF_AGENT_NETWORK === "testnet" ? "testnet" : "mainnet",
    selfRpcUrl: env.SELF_RPC_URL || env.CELO_RPC_URL || undefined,
    verifyTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
    callLogPath: env.CALL_LOG_PATH || undefined,
    paymentSyncOnStart: env.X402_SYNC_ON_START !== "false",
  };
}

/** Celo mainnet (chain 42220) USDC — EIP-3009 token, 6 decimals. */
export const CELO_MAINNET_NETWORK = "eip155:42220" as const;
export const USDC_CELO_MAINNET = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
export const CELO_FACILITATOR_URL = "https://api.x402.celo.org";

/**
 * Explicit price for one snapshot: 0.01 USDC. Always the explicit object
 * form — a bare "$0.01" string would silently resolve through the
 * default-asset table (see spec/research.md §3).
 */
export const SNAPSHOT_PRICE = {
  amount: "10000",
  asset: USDC_CELO_MAINNET,
  extra: { name: "USDC", version: "2" },
} as const;

/** Maximum accepted topic length; longer input is a 400, never a 500. */
export const MAX_TOPIC_LENGTH = 200;
