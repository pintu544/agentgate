/**
 * QA probes against the REAL Self SDK verifier (no module mocks) and a
 * real Express server over HTTP. Uses a fresh, unregistered ECDSA key —
 * every request must be denied; the ERROR STRING tells us which stage
 * denied it (freshness / signature / replay / on-chain), which is what
 * these probes actually measure.
 */
import { describe, it, expect, beforeAll } from "vitest";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { ethers } from "ethers";
// SDK signing primitives (same code the real agent + verifier share).
import { computeSigningMessage } from "@selfxyz/agent-sdk/dist/signing.js";
import { createApp } from "../src/app.js";
import type { SellerConfig } from "../src/config.js";

const wallet = ethers.Wallet.createRandom();
const BODY = JSON.stringify({ topic: "Acme Corp" });

let baseUrl = "";
let baseUrlBadRpc = "";

async function startApp(overrides: Partial<SellerConfig>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentgate-qa-real-"));
  const app = createApp({
    exaApiKey: "qa-dummy-exa-key",
    verifyTimeoutMs: 8000,
    callLogPath: path.join(dir, "calls.jsonl"),
    ...overrides,
  });
  const server = http.createServer(app as never);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

async function signHeaders(
  body: string,
  opts: { timestamp?: string; url?: string; method?: string } = {},
): Promise<Record<string, string>> {
  const timestamp = opts.timestamp ?? String(Date.now());
  const url = opts.url ?? "/api/snapshot";
  const method = opts.method ?? "POST";
  const message = computeSigningMessage(timestamp, method, url, body);
  const signature = await wallet.signMessage(ethers.getBytes(message));
  return {
    "x-self-agent-signature": signature,
    "x-self-agent-timestamp": timestamp,
    "x-self-agent-address": wallet.address,
  };
}

async function post(
  base: string,
  headers: Record<string, string>,
  body: string | Buffer,
): Promise<{ status: number; json: { error?: string } }> {
  const res = await fetch(`${base}/api/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, json };
}

beforeAll(async () => {
  baseUrl = await startApp({});
  baseUrlBadRpc = await startApp({
    selfRpcUrl: "https://celo-mainnet.core.chainstack.com/QA_FAKE_KEY_1234567890",
  });
}, 60_000);

describe("QA real-SDK: stage-by-stage deny behaviour (unregistered key)", () => {
  it("properly signed request from an unregistered key is denied at the on-chain stage (or RPC stage), never served", async () => {
    const headers = await signHeaders(BODY);
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] signed unregistered ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).not.toBe("Invalid signature");
    expect(res.json.error).not.toBe("Timestamp expired or invalid");
  }, 30_000);

  it("replaying the identical signed request is denied as a replay", async () => {
    const headers = await signHeaders(BODY);
    const first = await post(baseUrl, headers, BODY);
    const second = await post(baseUrl, headers, BODY);
    console.log(
      "[qa-real] replay first ->", first.status, JSON.stringify(first.json),
      "| second ->", second.status, JSON.stringify(second.json),
    );
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(second.json.error).toBe("Replay detected");
  }, 60_000);

  it("body tampered after signing is denied: recovery attributes it to a different, unregistered address", async () => {
    // ECDSA recovery has no "invalid signature" outcome for a well-formed
    // signature over a different message — it recovers a DIFFERENT address,
    // which is unregistered, so the deny surfaces as the on-chain error.
    // The security property holds: tampering cannot re-attribute the
    // request to any registered agent.
    const headers = await signHeaders(BODY);
    const tampered = JSON.stringify({ topic: "Evil Corp" });
    const res = await post(baseUrl, headers, tampered);
    console.log("[qa-real] tampered body ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Agent not verified on-chain");
  }, 30_000);

  it("truly duplicated signature header lines are denied as an invalid signature", async () => {
    const headers = await signHeaders(BODY);
    const url = new URL(`${baseUrl}/api/snapshot`);
    const outcome = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          method: "POST",
          path: url.pathname,
          headers: {
            "content-type": "application/json",
            // Array value => Node sends two separate header lines.
            "x-self-agent-signature": [headers["x-self-agent-signature"], headers["x-self-agent-signature"]],
            "x-self-agent-timestamp": headers["x-self-agent-timestamp"],
            "x-self-agent-address": headers["x-self-agent-address"],
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
          );
        },
      );
      req.on("error", reject);
      req.write(BODY);
      req.end();
    });
    console.log("[qa-real] duplicated sig lines ->", outcome.status, outcome.body.slice(0, 160));
    expect(outcome.status).toBe(401);
    expect(outcome.body).toContain("Invalid signature");
  }, 30_000);

  it("timestamp 6 minutes in the future is denied at the freshness stage", async () => {
    const headers = await signHeaders(BODY, { timestamp: String(Date.now() + 6 * 60_000) });
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] future ts ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Timestamp expired or invalid");
  }, 30_000);

  it("timestamp 6 minutes in the past is denied at the freshness stage", async () => {
    const headers = await signHeaders(BODY, { timestamp: String(Date.now() - 6 * 60_000) });
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] past ts ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Timestamp expired or invalid");
  }, 30_000);

  it("timestamp with garbage suffix: parseInt accepts it, signature (over the raw string) still binds it", async () => {
    const ts = `${Date.now()}garbage`;
    const headers = await signHeaders(BODY, { timestamp: ts });
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] garbage-suffix ts ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    // Freshness passed (parseInt), signature valid (signed the raw string),
    // so the deny must come from a later stage.
    expect(res.json.error).not.toBe("Timestamp expired or invalid");
    expect(res.json.error).not.toBe("Invalid signature");
  }, 30_000);

  it("invalid-UTF8 body bytes that lossy-decode to the signed string: which stage denies?", async () => {
    // Signed body string contains U+FFFD; raw bytes carry 0xFF instead of
    // the 3-byte UTF-8 encoding of U+FFFD. Buffer.toString('utf8') maps
    // 0xFF -> U+FFFD, so the app's verifier input string is identical.
    const signedBody = '{"topic":"A�B"}';
    const headers = await signHeaders(signedBody);
    const rawBytes = Buffer.concat([
      Buffer.from('{"topic":"A', "utf8"),
      Buffer.from([0xff]),
      Buffer.from('B"}', "utf8"),
    ]);
    const res = await post(baseUrl, headers, rawBytes);
    console.log("[qa-real] invalid-utf8 body ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    // If error is NOT "Invalid signature", the signature stage accepted a
    // body whose raw bytes differ from what was signed (lossy decode).
    console.log(
      "[qa-real] signature stage bypassed by lossy decode?",
      res.json.error !== "Invalid signature",
    );
  }, 30_000);
});

describe("QA real-SDK: Ed25519 path through the vendored shim", () => {
  it("random ed25519 key + random signature is denied as invalid", async () => {
    const headers = {
      "x-self-agent-signature": "0x" + "11".repeat(64),
      "x-self-agent-timestamp": String(Date.now()),
      "x-self-agent-keytype": "ed25519",
      "x-self-agent-key": "0x" + "22".repeat(32),
    };
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] ed25519 garbage ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Invalid Ed25519 signature");
  }, 30_000);

  it("ed25519 with a 31-byte agent key is denied, not a 500", async () => {
    const headers = {
      "x-self-agent-signature": "0x" + "11".repeat(64),
      "x-self-agent-timestamp": String(Date.now()),
      "x-self-agent-keytype": "ed25519",
      "x-self-agent-key": "0x" + "22".repeat(31),
    };
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] ed25519 short key ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Invalid Ed25519 signature");
  }, 30_000);

  it("ed25519 with a 63-byte signature is denied, not a 500", async () => {
    const headers = {
      "x-self-agent-signature": "0x" + "11".repeat(63),
      "x-self-agent-timestamp": String(Date.now()),
      "x-self-agent-keytype": "ed25519",
      "x-self-agent-key": "0x" + "22".repeat(32),
    };
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] ed25519 short sig ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Invalid Ed25519 signature");
  }, 30_000);

  it("keytype ed25519 but missing agent key header is denied by the app pre-check", async () => {
    const headers = {
      "x-self-agent-signature": "0x" + "11".repeat(64),
      "x-self-agent-timestamp": String(Date.now()),
      "x-self-agent-keytype": "ed25519",
    };
    const res = await post(baseUrl, headers, BODY);
    console.log("[qa-real] ed25519 no key ->", res.status, JSON.stringify(res.json));
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("Missing agent authentication headers");
  }, 30_000);
});

describe("QA real-SDK: RPC failure error content (info-leak check)", () => {
  it("C1 regression: a failing RPC endpoint's error never leaks the endpoint URL/key", async () => {
    const headers = await signHeaders(BODY);
    const res = await post(baseUrlBadRpc, headers, BODY);
    console.log("[qa-real] bad-rpc ->", res.status, JSON.stringify(res.json).slice(0, 500));
    expect(res.status).toBe(401);
    const error = res.json.error ?? "";
    console.log(
      "[qa-real] error leaks RPC url?",
      error.includes("chainstack"),
      "| leaks fake key?",
      error.includes("QA_FAKE_KEY"),
    );
    expect(error).not.toContain("chainstack");
    expect(error).not.toContain("QA_FAKE_KEY");
    expect(error).not.toContain("http");
  }, 60_000);
});
