/**
 * Buyer configuration, read from environment only. The agent wallet's
 * private key lives in buyer/.env (gitignored) or the shell environment —
 * never in code, never in a commit.
 *
 * - BUYER_PRIVATE_KEY: agent wallet key (0x + 64 hex). Required.
 * - SELLER_URL: AgentGate seller base URL.
 * - CELO_RPC_URL: Celo mainnet RPC. Defaults to the public Forno endpoint —
 *   the design called for Chainstack, but no Chainstack key exists in
 *   Doppler, so the public RPC is used (see TASKS T2.1 note).
 * - BUYER_MAX_PER_PAYMENT_ATOMIC: client-side spend cap per payment, in
 *   USDC atomic units (6 decimals). Default 10000 = 0.01 USDC, exactly the
 *   snapshot price — anything pricier is refused before signing.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ATTRIBUTION_TAG = "celo_b4690008b08e";
export const CELO_MAINNET_CHAIN_ID = 42220;
export const CELO_NETWORK = "eip155:42220" as const;
export const USDC_CELO_MAINNET = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const;
export const DEFAULT_RPC_URL = "https://forno.celo.org";
export const DEFAULT_SELLER_URL = "https://agentgate-seller.vercel.app";

export interface BuyerConfig {
  privateKey: `0x${string}`;
  sellerUrl: string;
  rpcUrl: string;
  maxPerPaymentAtomic: string;
  reportsDir: string;
}

/** Minimal .env loader (KEY=VALUE lines); real environment wins. */
export function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function buyerDir(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BuyerConfig {
  const rawKey = env.BUYER_PRIVATE_KEY ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error(
      "BUYER_PRIVATE_KEY is missing or malformed (expected 0x + 64 hex chars). " +
        "Run `npm run gen-key` in buyer/ to create a throwaway dev wallet in buyer/.env.",
    );
  }
  const cap = env.BUYER_MAX_PER_PAYMENT_ATOMIC ?? "10000";
  if (!/^\d+$/.test(cap)) {
    throw new Error("BUYER_MAX_PER_PAYMENT_ATOMIC must be an integer string of atomic units.");
  }
  return {
    privateKey: rawKey as `0x${string}`,
    sellerUrl: (env.SELLER_URL ?? DEFAULT_SELLER_URL).replace(/\/$/, ""),
    rpcUrl: env.CELO_RPC_URL ?? DEFAULT_RPC_URL,
    maxPerPaymentAtomic: cap,
    reportsDir: env.BUYER_REPORTS_DIR ?? join(buyerDir(), "reports"),
  };
}
