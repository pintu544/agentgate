/**
 * Generate a fresh THROWAWAY buyer wallet key into buyer/.env (mode 0600).
 * Development only: this wallet is unregistered and unfunded; the real
 * agent wallet's key belongs in Doppler/env, set by the project owner.
 * Prints the public address only — never the key. Refuses to overwrite
 * an existing .env.
 */
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const dir = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(dir, ".env");
if (existsSync(envPath)) {
  console.error(`Refusing to overwrite existing ${envPath}`);
  process.exit(1);
}
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
writeFileSync(
  envPath,
  [
    `# AgentGate buyer — THROWAWAY dev wallet. Never commit. Never fund with real money.`,
    `BUYER_PRIVATE_KEY=${key}`,
    `SELLER_URL=https://agentgate-seller.vercel.app`,
    `CELO_RPC_URL=https://forno.celo.org`,
    `BUYER_MAX_PER_PAYMENT_ATOMIC=10000`,
    ``,
  ].join("\n"),
  { mode: 0o600 },
);
chmodSync(envPath, 0o600);
console.log(`Wrote ${envPath} (0600). Throwaway buyer address: ${account.address}`);
