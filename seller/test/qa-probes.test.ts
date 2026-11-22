/**
 * QA probes (adversarial, added by the Slice 1 QA reviewer — not part of
 * the shipped suite). Same module-boundary mocking as snapshot.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

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
      throw new Error("stub facilitator: verify not exercised");
    }
    async settle(): Promise<never> {
      throw new Error("stub facilitator: settle not exercised");
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
const VERIFIED = {
  valid: true,
  agentAddress: "0x1111111111111111111111111111111111111111",
  agentId: "7",
};

async function makeApp(overrides: Partial<SellerConfig> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentgate-qa-"));
  const callLogPath = path.join(dir, "calls.jsonl");
  const app = createApp({ exaApiKey: "test-exa-key", callLogPath, ...overrides });
  return { app, callLogPath };
}

async function readLog(callLogPath: string) {
  // Log writes land asynchronously on response finish; poll briefly so
  // parallel-suite load cannot race the append (a fixed sleep flaked).
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

/** Poll GET /log until it contains `needle` (or the deadline passes). */
async function logPageContaining(
  app: Parameters<typeof request>[0],
  needle: string,
): Promise<string> {
  const deadline = Date.now() + 3000;
  let text = "";
  while (Date.now() < deadline) {
    const res = await request(app).get("/log");
    text = res.text;
    if (text.includes(needle)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return text;
}

/** Raw HTTP request helper for things supertest can't express.
 *  A header value may be an array — Node then sends one header line per
 *  element (true on-the-wire duplicates). */
function rawRequest(
  app: Parameters<typeof request>[0],
  opts: {
    method: string;
    path: string;
    headers: Array<[string, string | string[]]>;
    body?: Buffer | string;
  },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app as never);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of opts.headers) headers[k] = v;
      const req = http.request(
        { host: "127.0.0.1", port, method: opts.method, path: opts.path, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue(VERIFIED);
});

describe("QA: payment-gate route variations (gate configured, caller verified)", () => {
  const paid = { x402ApiKey: "x402_test_dummy", sellerPayTo: "0x000000000000000000000000000000000000dEaD" };

  it("trailing slash /api/snapshot/ must still hit the payment gate (402, not 200)", async () => {
    const { app } = await makeApp(paid);
    const res = await request(app).post("/api/snapshot/").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] POST /api/snapshot/ ->", res.status);
    expect(res.status).toBe(402);
  });

  it("uppercase /API/SNAPSHOT must still hit the payment gate (402, not 200)", async () => {
    const { app } = await makeApp(paid);
    const res = await request(app).post("/API/SNAPSHOT").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] POST /API/SNAPSHOT ->", res.status);
    expect(res.status).toBe(402);
  });

  it("query string /api/snapshot?x=1 must still hit the payment gate", async () => {
    const { app } = await makeApp(paid);
    const res = await request(app).post("/api/snapshot?x=1").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] POST /api/snapshot?x=1 ->", res.status);
    expect(res.status).toBe(402);
  });

  it("double slash /api//snapshot — observe behaviour", async () => {
    const { app } = await makeApp(paid);
    const res = await request(app).post("/api//snapshot").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] POST /api//snapshot ->", res.status, JSON.stringify(res.body).slice(0, 120));
    expect(res.status).not.toBe(200);
  });

  it("percent-encoded /api/%73napshot — observe behaviour", async () => {
    const { app } = await makeApp(paid);
    const res = await rawRequest(app, {
      method: "POST",
      path: "/api/%73napshot",
      headers: [
        ["content-type", "application/json"],
        ...Object.entries(SIGNED_HEADERS),
      ],
      body: JSON.stringify({ topic: "Acme" }),
    });
    console.log("[qa] POST /api/%73napshot ->", res.status, res.body.slice(0, 120));
    expect(res.status).not.toBe(200);
  });

  it("GET / HEAD / PUT on /api/snapshot are not served", async () => {
    const { app } = await makeApp(paid);
    const g = await request(app).get("/api/snapshot").set(SIGNED_HEADERS);
    const h = await request(app).head("/api/snapshot").set(SIGNED_HEADERS);
    const p = await request(app).put("/api/snapshot").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] GET ->", g.status, "HEAD ->", h.status, "PUT ->", p.status);
    expect(g.status).toBe(404);
    expect(h.status).toBe(404);
    expect(p.status).toBe(404);
  });
});

describe("QA: 402 payload detail (price object exactly as spec'd)", () => {
  it("dumps the full accepts entry for manual verification", async () => {
    const { app } = await makeApp({
      x402ApiKey: "x402_test_dummy",
      sellerPayTo: "0x000000000000000000000000000000000000dEaD",
    });
    const res = await request(app).post("/api/snapshot").set(SIGNED_HEADERS).send({ topic: "Acme" });
    expect(res.status).toBe(402);
    const decoded = JSON.parse(
      Buffer.from(res.headers["payment-required"] as string, "base64").toString("utf8"),
    );
    console.log("[qa] 402 payload:", JSON.stringify(decoded, null, 1).slice(0, 900));
    const a = decoded.accepts[0];
    expect(a.scheme).toBe("exact");
    expect(a.network).toBe("eip155:42220");
    expect(a.asset.toLowerCase()).toBe("0xceba9300f2b948710d2653dd7b07f33a8b32118c");
    expect(a.amount).toBe("10000");
    expect(a.payTo).toBe("0x000000000000000000000000000000000000dEaD");
    expect(a.extra?.name).toBe("USDC");
    expect(a.extra?.version).toBe("2");
  });
});

describe("QA: header fuzzing", () => {
  it("duplicated signature header: Node joins the two lines; the joined value reaches the verifier", async () => {
    // With the boundary mocked "valid", the app serves — the point of this
    // probe is to document WHAT the verifier receives for true duplicate
    // headers: a single ", "-joined string, which the real SDK rejects at
    // signature parsing (proven against the real SDK in qa-real.test.ts).
    const { app } = await makeApp();
    const res = await rawRequest(app, {
      method: "POST",
      path: "/api/snapshot",
      headers: [
        ["content-type", "application/json"],
        ["x-self-agent-signature", ["0x" + "ab".repeat(65), "0x" + "cd".repeat(65)]],
        ["x-self-agent-timestamp", String(Date.now())],
      ],
      body: JSON.stringify({ topic: "Acme" }),
    });
    const seen = verifyMock.mock.calls.at(-1)?.[1] as { signature?: string } | undefined;
    console.log(
      "[qa] duplicated sig header ->", res.status,
      "| verifier received joined string?", seen?.signature?.includes(", ") === true,
      "| starts:", seen?.signature?.slice(0, 10), "| contains second sig?", seen?.signature?.includes("cdcd") === true,
    );
    expect(seen?.signature).toContain(", ");
    expect(seen?.signature).toContain("0x" + "ab".repeat(65));
    expect(seen?.signature).toContain("0x" + "cd".repeat(65));
  });

  it("keytype ED25519 (uppercase) with no agent key does not bypass", async () => {
    verifyMock.mockResolvedValue({ valid: false, error: "Invalid signature" });
    const { app } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set({ ...SIGNED_HEADERS, "x-self-agent-keytype": "ED25519" })
      .send({ topic: "Acme" });
    console.log("[qa] keytype=ED25519 ->", res.status, res.body.error);
    expect(res.status).toBe(401);
  });

  it("C1 regression: verifier error with stack-like content is replaced by the generic message", async () => {
    verifyMock.mockResolvedValue({
      valid: false,
      error: "Error: boom\n    at Object.<anonymous> (/home/hatch/workspace/agentgate/seller/src/x.ts:1:1)",
    });
    const { app, callLogPath } = await makeApp();
    const res = await request(app).post("/api/snapshot").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] stacky error ->", res.status, JSON.stringify(res.body).slice(0, 200));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Agent verification unavailable, try again later");
    expect(JSON.stringify(res.body)).not.toContain("/home/hatch");
    expect(JSON.stringify(res.body)).not.toContain("at Object");
    // The public call log must carry the sanitised string too.
    const entries = await readLog(callLogPath);
    expect(entries[0]?.error).toBe("Agent verification unavailable, try again later");
  });

  it("C1 regression: a credentialed RPC URL in a verifier error never reaches the caller or the log", async () => {
    verifyMock.mockResolvedValue({
      valid: false,
      error:
        'requestUrl: "https://celo-mainnet.core.chainstack.com/QA_FAKE_KEY_1234567890" (status 429)',
    });
    const { app, callLogPath } = await makeApp();
    const res = await request(app).post("/api/snapshot").set(SIGNED_HEADERS).send({ topic: "Acme" });
    console.log("[qa] url-bearing error ->", res.status, JSON.stringify(res.body).slice(0, 200));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Agent verification unavailable, try again later");
    expect(JSON.stringify(res.body)).not.toContain("QA_FAKE_KEY");
    const entries = await readLog(callLogPath);
    expect(entries[0]?.error).toBe("Agent verification unavailable, try again later");
    expect(JSON.stringify(entries)).not.toContain("QA_FAKE_KEY");
  });
});

describe("QA: content-type and body handling", () => {
  it("text/plain body with valid verification is NOT served (400, no snapshot)", async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .set("Content-Type", "text/plain")
      .send(JSON.stringify({ topic: "Acme" }));
    console.log("[qa] text/plain ->", res.status, JSON.stringify(res.body).slice(0, 120));
    expect(res.status).toBe(400);
    expect(res.body.summary).toBeUndefined();
  });

  it("body over the 16kb JSON limit is a 413, not a hang or 500", async () => {
    const { app } = await makeApp();
    const big = JSON.stringify({ topic: "Acme", pad: "x".repeat(20_000) });
    const res = await request(app)
      .post("/api/snapshot")
      .set(SIGNED_HEADERS)
      .set("Content-Type", "application/json")
      .send(big);
    console.log("[qa] 20kb body ->", res.status, JSON.stringify(res.body).slice(0, 120));
    expect(res.status).toBe(413);
  });

  it("topic of exactly 200 chars is served; 201 chars is a 400", async () => {
    const { app } = await makeApp();
    const ok = await request(app).post("/api/snapshot").set(SIGNED_HEADERS).send({ topic: "a".repeat(200) });
    const over = await request(app).post("/api/snapshot").set(SIGNED_HEADERS).send({ topic: "a".repeat(201) });
    console.log("[qa] topic 200 ->", ok.status, "| topic 201 ->", over.status);
    expect(ok.status).toBe(200);
    expect(over.status).toBe(400);
  });

  it("non-object JSON bodies (array, string, number, null) are 400s, never 500", async () => {
    const { app } = await makeApp();
    for (const body of ["[1,2]", '"hello"', "42", "null", "true"]) {
      const res = await request(app)
        .post("/api/snapshot")
        .set(SIGNED_HEADERS)
        .set("Content-Type", "application/json")
        .send(body);
      console.log("[qa] body", body, "->", res.status);
      expect(res.status).toBe(400);
    }
  });
});

describe("QA: log integrity and XSS", () => {
  it("topic containing HTML is escaped on /log (no stored XSS)", async () => {
    const { app } = await makeApp();
    const evil = '<script>alert(1)</script>';
    const res = await request(app).post("/api/snapshot").set(SIGNED_HEADERS).send({ topic: evil });
    expect(res.status).toBe(200);
    const logText = await logPageContaining(app, "&lt;script&gt;");
    console.log("[qa] /log contains raw script?", logText.includes(evil), "| escaped?", logText.includes("&lt;script&gt;"));
    expect(logText.includes(evil)).toBe(false);
    expect(logText.includes("&lt;script&gt;")).toBe(true);
  });

  it("attacker-controlled x-self-agent-address on a DENIED request is escaped on /log", async () => {
    verifyMock.mockResolvedValue({ valid: false, error: "Invalid signature" });
    const { app } = await makeApp();
    const evilAddr = '</td><script>alert(2)</script>';
    await request(app)
      .post("/api/snapshot")
      .set({ ...SIGNED_HEADERS, "x-self-agent-address": evilAddr })
      .send({ topic: "Acme" });
    const logText = await logPageContaining(app, "claimed:");
    console.log("[qa] /log contains raw addr script?", logText.includes("<script>alert(2)</script>"));
    expect(logText.includes("<script>alert(2)</script>")).toBe(false);
    // W3: the denied entry's claimed address renders in the Claimed
    // column (escaped, "claimed:"-prefixed), never as the caller.
    expect(logText).toContain("claimed: &lt;/td&gt;&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("W3 regression: denied entries keep the claimed address apart from the caller", async () => {
    verifyMock.mockResolvedValue({ valid: false, error: "Invalid signature" });
    const { app, callLogPath } = await makeApp();
    await request(app)
      .post("/api/snapshot")
      .set({ ...SIGNED_HEADERS, "x-self-agent-address": "0xVictimVictimVictimVictimVictimVictim12" })
      .send({ topic: "Acme" });
    const entries = await readLog(callLogPath);
    console.log(
      "[qa] denied entry caller:", entries[0]?.caller,
      "| claimedAddress:", entries[0]?.claimedAddress,
      "| verified:", entries[0]?.verified,
    );
    // The claimed address must NOT be recorded as the caller…
    expect(entries[0]?.caller).toBeNull();
    // …it is kept in its own field, marked as a mere claim.
    expect(entries[0]?.claimedAddress).toBe("0xVictimVictimVictimVictimVictimVictim12");
    expect(entries[0]?.verified).toBe(false);
    // And /log renders it distinctly, prefixed "claimed:".
    const logText = await logPageContaining(app, "claimed: 0xVictim");
    expect(logText).toContain("claimed: 0xVictimVictimVictimVictimVictimVictim12");
  });
});
