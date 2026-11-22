/**
 * Run report writer: one Markdown file per buyer session in reports/,
 * recording what was attempted, what the seller answered, and — when a
 * payment settled — the settlement transaction hash. Reports contain no
 * secrets (addresses and tx hashes are public on-chain data).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AttemptRecord } from "./signingFetch.js";

export interface RunReportData {
  startedAt: Date;
  buyerAddress: string;
  sellerUrl: string;
  rpcUrl: string;
  topic: string;
  outcome: "served" | "denied" | "payment-failed" | "error";
  httpStatus?: number;
  detail?: string;
  attempts: AttemptRecord[];
  spendCapAtomic: string;
  settlementTx?: string;
  snapshotFile?: string;
}

export function writeRunReport(dir: string, data: RunReportData): string {
  mkdirSync(dir, { recursive: true });
  const stamp = data.startedAt.toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}-run.md`);
  const lines = [
    `# AgentGate buyer run — ${data.startedAt.toISOString()}`,
    ``,
    `- Buyer (agent wallet): ${data.buyerAddress}`,
    `- Seller: ${data.sellerUrl}`,
    `- RPC: ${data.rpcUrl}`,
    `- Topic: ${data.topic}`,
    `- Spend cap per payment: ${data.spendCapAtomic} atomic USDC (6 dp)`,
    `- Outcome: **${data.outcome}**${data.httpStatus ? ` (HTTP ${data.httpStatus})` : ""}`,
  ];
  if (data.detail) lines.push(`- Detail: ${data.detail}`);
  if (data.settlementTx) lines.push(`- Settlement tx: ${data.settlementTx}`);
  if (data.snapshotFile) lines.push(`- Snapshot saved: ${data.snapshotFile}`);
  lines.push(``, `## Attempts`, ``);
  if (data.attempts.length === 0) lines.push(`(no HTTP attempt completed)`);
  for (const a of data.attempts) lines.push(`- ${a.method} ${a.url} → ${a.status}`);
  lines.push(``);
  writeFileSync(path, lines.join("\n"));
  return path;
}
