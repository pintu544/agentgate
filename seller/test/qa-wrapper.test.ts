/**
 * QA probes for the REAL src/selfVerifier wrapper (SDK mocked at the
 * package boundary) and the REAL src/exa fetch behaviour.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const sdkMock = vi.hoisted(() => ({
  verifyImpl: null as null | ((p: unknown) => Promise<unknown>),
  fromConfigArgs: [] as unknown[],
}));
vi.mock("@selfxyz/agent-sdk", () => ({
  SelfAgentVerifier: {
    fromConfig: (config: unknown) => {
      sdkMock.fromConfigArgs.push(config);
      return {
        verify: (params: unknown) => {
          if (!sdkMock.verifyImpl) throw new Error("no impl set");
          return sdkMock.verifyImpl(params);
        },
      };
    },
  },
}));

import { verifyAgentRequest } from "../src/selfVerifier.js";
import { generateSnapshot } from "../src/exa.js";
import type { SellerConfig } from "../src/config.js";

let rpcCounter = 0;
function cfg(overrides: Partial<SellerConfig> = {}): SellerConfig {
  return {
    selfNetwork: "mainnet",
    // Unique RPC per test: the wrapper caches verifiers by network|rpcUrl.
    selfRpcUrl: `https://rpc.invalid/qa-${++rpcCounter}`,
    verifyTimeoutMs: 300,
    paymentSyncOnStart: false,
    ...overrides,
  };
}
const INPUT = {
  signature: "0x" + "ab".repeat(65),
  timestamp: String(Date.now()),
  method: "POST",
  url: "/api/snapshot",
  body: "{}",
};

afterEach(() => {
  sdkMock.verifyImpl = null;
  vi.unstubAllGlobals();
});

describe("QA: selfVerifier timeout race and error mapping", () => {
  it("a verifier that never resolves is denied by the wrapper timeout", async () => {
    sdkMock.verifyImpl = () => new Promise(() => {});
    const started = Date.now();
    const result = await verifyAgentRequest(cfg(), INPUT);
    const elapsed = Date.now() - started;
    console.log("[qa-wrapper] hang -> valid:", result.valid, "| error:", result.error, "| elapsed ms:", elapsed);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Agent verification timed out");
    expect(elapsed).toBeLessThan(3000);
  });

  it("a verifier that resolves AFTER the timeout cannot flip the deny", async () => {
    sdkMock.verifyImpl = () =>
      new Promise((r) => setTimeout(() => r({ valid: true, agentAddress: "0xabc" }), 900));
    const result = await verifyAgentRequest(cfg(), INPUT);
    console.log("[qa-wrapper] late-valid -> valid:", result.valid, "| error:", result.error);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Agent verification timed out");
  });

  it("an SDK throw with a non-Error value maps to the generic message", async () => {
    sdkMock.verifyImpl = () => Promise.reject("raw string failure");
    const result = await verifyAgentRequest(cfg(), INPUT);
    console.log("[qa-wrapper] non-Error throw ->", result.valid, JSON.stringify(result.error));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Agent verification unavailable, try again later");
  });

  it("C1 regression: an SDK Error's message is NOT passed through — it maps to the generic message", async () => {
    sdkMock.verifyImpl = () =>
      Promise.reject(new Error("fetch failed for https://rpc.example.com/SECRETKEY123 (status 429)"));
    const result = await verifyAgentRequest(cfg(), INPUT);
    console.log("[qa-wrapper] Error passthrough ->", JSON.stringify(result.error));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Agent verification unavailable, try again later");
    expect(result.error).not.toContain("SECRETKEY123");
    expect(result.error).not.toContain("rpc.example.com");
  });

  it("C1 regression: a safe SDK denial string still passes through verbatim", async () => {
    sdkMock.verifyImpl = () => Promise.resolve({ valid: false, error: "Agent not verified on-chain" });
    const result = await verifyAgentRequest(cfg(), INPUT);
    console.log("[qa-wrapper] safe denial ->", JSON.stringify(result.error));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Agent not verified on-chain");
  });

  it("C1 regression: an unsafe result.error (URL-bearing) is replaced by the generic message", async () => {
    sdkMock.verifyImpl = () =>
      Promise.resolve({
        valid: false,
        error: "could not fetch from https://celo-mainnet.core.chainstack.com/SECRETKEY123",
      });
    const result = await verifyAgentRequest(cfg(), INPUT);
    console.log("[qa-wrapper] unsafe result.error ->", JSON.stringify(result.error));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Agent verification unavailable, try again later");
    expect(result.error).not.toContain("SECRETKEY123");
  });
});

describe("QA: verifier construction (W2 rate limit)", () => {
  it("W2 regression: fromConfig is given a per-agent rate limit of 30/minute", async () => {
    sdkMock.verifyImpl = () => Promise.resolve({ valid: false, error: "Agent not verified on-chain" });
    const before = sdkMock.fromConfigArgs.length;
    await verifyAgentRequest(cfg(), INPUT); // unique RPC URL => fresh verifier
    const config = sdkMock.fromConfigArgs.at(-1) as { rateLimit?: { perMinute?: number } };
    console.log("[qa-wrapper] fromConfig calls:", sdkMock.fromConfigArgs.length - before, "| rateLimit:", JSON.stringify(config?.rateLimit));
    expect(sdkMock.fromConfigArgs.length).toBe(before + 1);
    expect(config?.rateLimit).toEqual({ perMinute: 30 });
  });
});

describe("QA: exa generateSnapshot fetch timeout (W4)", () => {
  it("W4 regression: a hung Exa response is aborted by the internal timeout and rejects", async () => {
    // Stub fetch the way real fetch behaves: it never resolves on its
    // own, but rejects when the caller's AbortSignal fires.
    vi.stubGlobal(
      "fetch",
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return; // would hang; generateSnapshot must pass one
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const outcome = await Promise.race([
      generateSnapshot("Acme", "qa-key", 300).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((r) => setTimeout(() => r("still-pending-after-2s"), 2000)),
    ]);
    console.log("[qa-wrapper] hung exa fetch ->", outcome);
    expect(outcome).toBe("rejected");
  });
});
