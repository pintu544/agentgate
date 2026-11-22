/**
 * AgentGate buyer CLI.
 *
 *   npm start -- info            Wallet address, Self Agent ID status, balances.
 *   npm start -- buy "<topic>"   Buy one snapshot from the seller: the request
 *                                is Self-signed; if the seller answers 402 the
 *                                x402 client pays (within the spend cap) and
 *                                retries. A Markdown run report is written to
 *                                reports/ either way.
 *
 * Exit codes: 0 served · 1 error · 2 denied by the Self gate · 3 payment failed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { erc20Abi, formatEther, formatUnits } from "viem";
import { buildClients } from "./clients.js";
import { buyerDir, loadConfig, loadDotEnv, USDC_CELO_MAINNET } from "./config.js";
import { writeRunReport, type RunReportData } from "./report.js";
import { createSigningFetch, type AttemptRecord } from "./signingFetch.js";

async function info(): Promise<number> {
  const cfg = loadConfig();
  const { account, publicClient, selfAgent } = buildClients(cfg);
  console.log(`Agent wallet: ${account.address}`);
  console.log(`RPC: ${cfg.rpcUrl}`);
  try {
    const info = await selfAgent.getInfo();
    console.log(
      `Self Agent ID: agentId=${info.agentId ?? "none"} isVerified=${info.isVerified} ` +
        `proofExpiresAt=${info.proofExpiresAt ?? "n/a"}`,
    );
  } catch (err) {
    console.log(`Self Agent ID: lookup failed (${err instanceof Error ? err.message : String(err)})`);
  }
  const celo = await publicClient.getBalance({ address: account.address });
  const usdc = await publicClient.readContract({
    address: USDC_CELO_MAINNET,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`Balances: ${formatEther(celo)} CELO · ${formatUnits(usdc, 6)} USDC`);
  console.log(`Spend cap per payment: ${cfg.maxPerPaymentAtomic} atomic USDC`);
  return 0;
}

async function buy(topic: string): Promise<number> {
  const cfg = loadConfig();
  const clients = buildClients(cfg);
  const attempts: AttemptRecord[] = [];
  const signingFetch = createSigningFetch(clients.selfAgent, (a) => attempts.push(a));
  const payFetch = wrapFetchWithPayment(signingFetch, clients.paymentClient);
  const startedAt = new Date();
  const base: Omit<RunReportData, "outcome"> = {
    startedAt,
    buyerAddress: clients.account.address,
    sellerUrl: cfg.sellerUrl,
    rpcUrl: cfg.rpcUrl,
    topic,
    attempts,
    spendCapAtomic: cfg.maxPerPaymentAtomic,
  };
  const finish = (data: RunReportData, code: number): number => {
    const path = writeRunReport(cfg.reportsDir, data);
    console.log(`Outcome: ${data.outcome}${data.httpStatus ? ` (HTTP ${data.httpStatus})` : ""}`);
    if (data.detail) console.log(`Detail: ${data.detail}`);
    if (data.settlementTx) console.log(`Settlement tx: ${data.settlementTx}`);
    console.log(`Run report: ${path}`);
    return code;
  };

  let res: Response;
  try {
    res = await payFetch(`${cfg.sellerUrl}/api/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
  } catch (err) {
    // The x402 client throws when payment creation fails (spend-control
    // refusal, insufficient balance, unsupported requirements…).
    return finish(
      { ...base, outcome: "payment-failed", detail: err instanceof Error ? err.message : String(err) },
      3,
    );
  }

  const text = await res.text();
  if (res.status === 200) {
    let settlementTx: string | undefined;
    const header = res.headers.get("payment-response");
    if (header) {
      try {
        settlementTx = decodePaymentResponseHeader(header).transaction || undefined;
      } catch {
        settlementTx = undefined;
      }
    }
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const snapshotFile = join(cfg.reportsDir, `${stamp}-snapshot.json`);
    writeFileSync(snapshotFile, text);
    return finish(
      { ...base, outcome: "served", httpStatus: 200, settlementTx, snapshotFile },
      0,
    );
  }
  if (res.status === 401) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* keep raw body */
    }
    return finish({ ...base, outcome: "denied", httpStatus: 401, detail }, 2);
  }
  return finish(
    { ...base, outcome: "error", httpStatus: res.status, detail: text.slice(0, 300) },
    1,
  );
}

async function main(): Promise<void> {
  loadDotEnv(join(buyerDir(), ".env"));
  const [command, ...rest] = process.argv.slice(2);
  if (command === "info") {
    process.exitCode = await info();
  } else if (command === "buy" && rest.join(" ").trim()) {
    process.exitCode = await buy(rest.join(" ").trim());
  } else {
    console.error('Usage: npm start -- info | npm start -- buy "<topic>"');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
