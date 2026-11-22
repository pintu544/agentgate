import { describe, expect, it, vi } from "vitest";
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { ATTRIBUTION_TAG, loadConfig } from "../src/config.js";
import { createSigningFetch } from "../src/signingFetch.js";

describe("attribution tag", () => {
  it("encodes to the SDK's Schema 0 suffix (the research.md §5 hand-derived example was 2 bytes short in the marker — the SDK is authoritative)", () => {
    expect(toDataSuffix(ATTRIBUTION_TAG)).toBe(
      "0x63656c6f5f623436393030303862303865110080218021802180218021802180218021",
    );
  });
  it("round-trips through fromDataSuffix", () => {
    const decoded = fromDataSuffix(toDataSuffix(ATTRIBUTION_TAG));
    expect(decoded?.codes).toContain(ATTRIBUTION_TAG);
  });
});

describe("loadConfig", () => {
  it("rejects a missing key", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/BUYER_PRIVATE_KEY/);
  });
  it("rejects a malformed key", () => {
    expect(() => loadConfig({ BUYER_PRIVATE_KEY: "0x1234" } as NodeJS.ProcessEnv)).toThrow(
      /BUYER_PRIVATE_KEY/,
    );
  });
  it("accepts a well-formed key and applies defaults", () => {
    const cfg = loadConfig({ BUYER_PRIVATE_KEY: `0x${"11".repeat(32)}` } as NodeJS.ProcessEnv);
    expect(cfg.rpcUrl).toBe("https://forno.celo.org");
    expect(cfg.maxPerPaymentAtomic).toBe("10000");
  });
});

describe("createSigningFetch", () => {
  it("signs every call afresh and preserves pre-set headers (e.g. the x402 payment header)", async () => {
    let counter = 0;
    const fakeAgent = {
      signRequest: vi.fn(async () => {
        counter += 1;
        return {
          "x-self-agent-address": "0x0000000000000000000000000000000000000001",
          "x-self-agent-timestamp": String(1_700_000_000 + counter),
          "x-self-agent-signature": `0xsig${counter}`,
        };
      }),
    };
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push(headers.get("x-self-agent-signature"));
        expect(headers.get("payment-signature")).toBe("pay-header-value");
        return new Response("{}", { status: 402 });
      }),
    );
    const signingFetch = createSigningFetch(fakeAgent as never);
    const init: RequestInit = {
      method: "POST",
      headers: { "payment-signature": "pay-header-value" },
      body: JSON.stringify({ topic: "Acme" }),
    };
    await signingFetch("https://seller.example/api/snapshot", init);
    await signingFetch("https://seller.example/api/snapshot", init);
    expect(seen).toEqual(["0xsig1", "0xsig2"]);
    expect(fakeAgent.signRequest).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
