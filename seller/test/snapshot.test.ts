/**
 * Slice 1 gate tests. The Self SDK verifier and Exa are substituted at
 * their module boundaries (src/selfVerifier, src/exa); Express, the
 * middleware chain and the call log are the real thing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const verifyMock = vi.hoisted(() => vi.fn());
vi.mock("../src/selfVerifier", () => ({ verifyAgentRequest: verifyMock }));
vi.mock("../src/exa", () => ({
  generateSnapshot: vi.fn(async (topic: string) => ({
    topic,
    summary: `Summary for ${topic}`,
    keyFacts: ["Fact one"],
    sources: [{ title: "Example", url: "https://example.com" }],
  })),
}));

// Only the facilitator's network client is stubbed: the x402 resource
// server, the Express payment middleware and the EVM scheme stay real.
// The stub answers getSupported() with the Celo mainnet USDC kind; a
// no-payment request never reaches verify()/settle().
vi.mock("@x402/core/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@x402/core/server")>();
  class StubFacilitatorClient {
    async getSupported() {
      return {
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:42220" as const }],
        extensions: [] as string[],
        signers: {} as Record<string, string[]>,
      };
    }
    async verify(): Promise<never> {
      throw new Error("stub facilitator: verify is not exercised by these tests");
    }
    async settle(): Promise<never> {
      throw new Error("stub facilitator: settle is not exercised by these tests");
    }
  }
  return {
    ...orig,
    HTTPFacilitatorClient:
      StubFacilitatorClient as unknown as typeof orig.HTTPFacilitatorClient,
  };
});

import { createApp } from "../src/app.js";
import type { SellerConfig } from "../src/config.js";

const SIGNED_HEADERS = {
  "x-self-agent-signature": "0x" + "ab".repeat(65),
  "x-self-agent-timestamp": String(Date.now()),
  "x-self-agent-address": "0x1111111111111111111111111111111111111111",
};

async function makeApp(overrides: Partial<SellerConfig> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentgate-test-"));
  const callLogPath = path.join(dir, "calls.jsonl");
  const app = createApp({ exaApiKey: "test-exa-key", callLogPath, ...overrides });
  return { app, callLogPath };
}

async function readLog(callLogPath: string) {
  // Log writes land asynchronously on res finish; poll briefly instead
  // of a fixed sleep, which raced the append under parallel-suite load.
  const deadline = Date.now() + 3000;
  let entries: ReturnType<typeof JSON.parse>[] = [];
  while (Date.now() < deadline) {
    const raw = await readFile(callLogPath, "utf8").catch(() => "");
    entries = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    if (entries.length > 0) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return entries;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/snapshot — Self Agent ID gate", () => {
  it("rejects an unsigned request with 401 and the SDK's missing-headers error", async () => {
    const { app, callLogPath } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .send({ topic: "Acme Corp" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing agent authentication headers");
    expect(verifyMock).not.toHaveBeenCalled();
    const log = await readLog(callLogPath);
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe("denied");
    expect(log[0].verified).toBe(false);
  });

  it("rejects a request signed by an unregistered address with 401 and serves nothing", async () => {
    verifyMock.mockResolvedValue({ valid: false, error: "Agent not verified on-chain" });
    const { app, callLogPath } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .send({ topic: "Acme Corp" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Agent not verified on-chain");
    expect(res.body.summary).toBeUndefined();
    expect(res.body.sources).toBeUndefined();
    const log = await readLog(callLogPath);
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe("denied");
    expect(log[0].error).toBe("Agent not verified on-chain");
  });

  it("rejects a verifier exception as a 401 deny, never a 500", async () => {
    verifyMock.mockRejectedValue(new Error("chain unreadable"));
    const { app } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .send({ topic: "Acme Corp" });
    // selfVerifier converts throws into a failed result; if it ever threw
    // through, Express would answer 500 — the gate must not.
    expect(res.status).toBe(401);
  });
});

describe("POST /api/snapshot — body validation", () => {
  beforeEach(() => {
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x1111111111111111111111111111111111111111",
      agentId: "7",
    });
  });

  it("rejects an oversized topic with a 400, not a 500", async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .send({ topic: "x".repeat(5000) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid topic");
  });

  it("rejects malformed JSON with a 400 and no stack trace", async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid JSON body");
    expect(JSON.stringify(res.body)).not.toContain("at ");
  });
});

describe("POST /api/snapshot — served path (no payment gate configured)", () => {
  it("serves a snapshot to a verified agent and logs it as served", async () => {
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x1111111111111111111111111111111111111111",
      agentId: "7",
    });
    const { app, callLogPath } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .send({ topic: "Acme Corp" });
    expect(res.status).toBe(200);
    expect(res.body.topic).toBe("Acme Corp");
    expect(res.body.summary).toBeTruthy();
    expect(Array.isArray(res.body.keyFacts)).toBe(true);
    expect(Array.isArray(res.body.sources)).toBe(true);
    const log = await readLog(callLogPath);
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe("served");
    expect(log[0].verified).toBe(true);
    expect(log[0].topic).toBe("Acme Corp");
  });
});

describe("POST /api/snapshot — x402 payment gate (configured)", () => {
  it("answers a verified but unpaid request with 402 and payment requirements", async () => {
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x1111111111111111111111111111111111111111",
      agentId: "7",
    });
    const { app, callLogPath } = await makeApp({
      x402ApiKey: "x402_test_dummy",
      sellerPayTo: "0x000000000000000000000000000000000000dEaD",
    });
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .send({ topic: "Acme Corp" });
    expect(res.status).toBe(402);
    const required = res.headers["payment-required"];
    expect(typeof required).toBe("string");
    const decoded = JSON.parse(Buffer.from(required as string, "base64").toString("utf8"));
    const accepts = decoded.accepts as Array<{ network: string; asset: string; amount: string }>;
    expect(accepts[0].network).toBe("eip155:42220");
    expect(accepts[0].asset.toLowerCase()).toBe(
      "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
    );
    expect(accepts[0].amount).toBe("10000");
    const log = await readLog(callLogPath);
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe("payment-required");
  });
});

describe("GET /health and /log", () => {
  it("health answers 200", async () => {
    const { app } = await makeApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("log page renders recorded attempts", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/snapshot").send({ topic: "Acme Corp" });
    // Poll: the log append lands asynchronously on res finish.
    let text = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const res = await request(app).get("/log");
      expect(res.status).toBe(200);
      text = res.text;
      if (text.includes("denied")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(text).toContain("denied");
  });
});
