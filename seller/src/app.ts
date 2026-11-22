/**
 * AgentGate seller service.
 *
 * Request flow for POST /api/snapshot (spec/DESIGN.md):
 *   call logging → Self Agent ID verification (deny-by-default, 401)
 *   → body validation (400) → x402 payment gate (402, only when the
 *   facilitator key is configured) → Exa snapshot (200).
 * Nothing is served on any verification failure.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { paymentMiddleware } from "@x402/express";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type RoutesConfig,
} from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  CELO_FACILITATOR_URL,
  CELO_MAINNET_NETWORK,
  MAX_TOPIC_LENGTH,
  SNAPSHOT_PRICE,
  loadConfig,
  type SellerConfig,
} from "./config.js";
import { verifyAgentRequest } from "./selfVerifier.js";
import { appendCallLog, readCallLog, type CallResult } from "./callLog.js";
import { generateSnapshot } from "./exa.js";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

interface CallLocals {
  caller: string | null;
  verified: boolean;
  agentId?: string;
  topic?: string;
  error?: string;
}

function locals(res: Response): CallLocals {
  return res.locals as CallLocals;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Records every /api/snapshot attempt once the response finishes. */
function callLogContext(cfg: SellerConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = new Date().toISOString();
    res.locals.caller = req.header("x-self-agent-address") ?? null;
    res.locals.verified = false;
    res.on("finish", () => {
      const status = res.statusCode;
      const result: CallResult =
        status === 200 ? "served" : status === 402 ? "payment-required" : "denied";
      let settlement: string | null = null;
      if (status === 200) {
        const header =
          res.getHeader("payment-response") ?? res.getHeader("x-payment-response");
        if (typeof header === "string") {
          try {
            const decoded = JSON.parse(
              Buffer.from(header, "base64").toString("utf8"),
            ) as { transaction?: string };
            settlement = decoded.transaction ?? null;
          } catch {
            settlement = null;
          }
        }
      }
      const l = locals(res);
      void appendCallLog(
        {
          ts: startedAt,
          caller: l.caller,
          verified: l.verified,
          result,
          ...(l.error ? { error: l.error } : {}),
          ...(l.topic ? { topic: l.topic } : {}),
          ...(l.agentId ? { agentId: l.agentId } : {}),
          ...(result !== "denied"
            ? { amount: SNAPSHOT_PRICE.amount, asset: SNAPSHOT_PRICE.asset }
            : {}),
          settlement,
        },
        cfg.callLogPath,
      );
    });
    next();
  };
}

function deny(res: Response, error: string): void {
  locals(res).error = error;
  res.status(401).json({ error });
}

/** Self Agent ID gate — every failure mode resolves to a 401 deny. */
function requireVerifiedAgent(cfg: SellerConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const signature = req.header("x-self-agent-signature");
    const timestamp = req.header("x-self-agent-timestamp");
    const keytype = req.header("x-self-agent-keytype");
    const agentKey = req.header("x-self-agent-key");
    if (!signature || !timestamp || (keytype === "ed25519" && !agentKey)) {
      // Same machine-readable string the SDK's own middleware uses.
      deny(res, "Missing agent authentication headers");
      return;
    }
    let result;
    try {
      result = await verifyAgentRequest(cfg, {
        signature,
        timestamp,
        method: req.method,
        url: req.originalUrl,
        body: req.rawBody ? req.rawBody.toString("utf8") : "",
        keytype,
        agentKey,
      });
    } catch {
      // The wrapper is built to never throw; if it ever does, still deny.
      deny(res, "Agent verification unavailable, try again later");
      return;
    }
    if (!result.valid) {
      deny(res, result.error ?? "Agent not verified on-chain");
      return;
    }
    const l = locals(res);
    l.verified = true;
    if (result.agentAddress) l.caller = result.agentAddress;
    if (result.agentId) l.agentId = result.agentId;
    next();
  };
}

function validateSnapshotBody(req: Request, res: Response, next: NextFunction) {
  const topic = (req.body as { topic?: unknown } | undefined)?.topic;
  if (typeof topic === "string") locals(res).topic = topic.slice(0, MAX_TOPIC_LENGTH);
  if (
    typeof topic !== "string" ||
    topic.trim().length === 0 ||
    topic.length > MAX_TOPIC_LENGTH
  ) {
    locals(res).error = `Invalid topic: must be a non-empty string of at most ${MAX_TOPIC_LENGTH} characters`;
    res.status(400).json({ error: locals(res).error });
    return;
  }
  next();
}

function buildPaymentGate(cfg: SellerConfig) {
  const facilitator = new HTTPFacilitatorClient({
    url: CELO_FACILITATOR_URL,
    createAuthHeaders: async () => {
      const headers = { "X-API-Key": cfg.x402ApiKey as string };
      return { verify: headers, settle: headers, supported: headers };
    },
  });
  const server = new x402ResourceServer(facilitator);
  registerExactEvmScheme(server, {});
  const routes: RoutesConfig = {
    "POST /api/snapshot": {
      accepts: {
        scheme: "exact",
        payTo: cfg.sellerPayTo as string,
        price: {
          amount: SNAPSHOT_PRICE.amount,
          asset: SNAPSHOT_PRICE.asset,
          extra: { ...SNAPSHOT_PRICE.extra },
        },
        network: CELO_MAINNET_NETWORK,
      },
      description: "AgentGate prospect research snapshot",
      mimeType: "application/json",
    },
  };
  return paymentMiddleware(routes, server, undefined, undefined, cfg.paymentSyncOnStart);
}

export function createApp(overrides: Partial<SellerConfig> = {}) {
  const cfg: SellerConfig = { ...loadConfig(), ...overrides };
  const paymentEnabled = Boolean(cfg.x402ApiKey && cfg.sellerPayTo);
  if (!cfg.x402ApiKey) {
    console.warn(
      "[agentgate] X402_API_KEY is not set — x402 payment middleware NOT mounted. " +
        "Verified requests will be served without payment. Set X402_API_KEY and SELLER_PAY_TO to enable the payment gate.",
    );
  } else if (!cfg.sellerPayTo) {
    console.warn(
      "[agentgate] SELLER_PAY_TO is not set — x402 payment middleware NOT mounted.",
    );
  }
  if (!cfg.exaApiKey) {
    console.warn("[agentgate] EXA_API_KEY is not set — snapshot generation will answer 503.");
  }

  const app = express();
  app.disable("x-powered-by");
  // The Self verifier hashes the exact body bytes — keep them as rawBody.
  app.use(
    express.json({
      limit: "16kb",
      verify: (req, _res, buf) => {
        (req as Request).rawBody = Buffer.from(buf);
      },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "agentgate-seller", paymentGate: paymentEnabled });
  });

  const chain: Array<(req: Request, res: Response, next: NextFunction) => unknown> = [
    callLogContext(cfg),
    requireVerifiedAgent(cfg),
    validateSnapshotBody,
  ];
  if (paymentEnabled) chain.push(buildPaymentGate(cfg));
  chain.push(async (req: Request, res: Response) => {
    if (!cfg.exaApiKey) {
      res.status(503).json({ error: "Snapshot generation is not configured" });
      return;
    }
    try {
      const snapshot = await generateSnapshot(
        ((req.body as { topic: string }).topic as string).trim(),
        cfg.exaApiKey,
      );
      res.json(snapshot);
    } catch (err) {
      console.error("[agentgate] snapshot generation failed", err);
      locals(res).error = "Snapshot generation failed";
      res.status(502).json({ error: "Snapshot generation failed" });
    }
  });
  app.post("/api/snapshot", ...chain);

  app.get("/log", async (_req, res) => {
    const entries = (await readCallLog(cfg.callLogPath)).slice(-200).reverse();
    const rows = entries
      .map(
        (e) =>
          `<tr><td>${escapeHtml(e.ts)}</td><td>${escapeHtml(e.caller ?? "—")}</td>` +
          `<td>${e.verified ? "yes" : "no"}</td><td>${escapeHtml(e.result)}</td>` +
          `<td>${escapeHtml(e.topic ?? "")}</td><td>${escapeHtml(e.error ?? "")}</td>` +
          `<td>${escapeHtml(e.settlement ?? "")}</td></tr>`,
      )
      .join("\n");
    res
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>AgentGate — call log</title></head>` +
          `<body><h1>AgentGate call log</h1><p>Every POST /api/snapshot attempt, newest first.</p>` +
          `<table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Time (UTC)</th><th>Caller</th>` +
          `<th>Verified</th><th>Result</th><th>Topic</th><th>Error</th><th>Settlement tx</th></tr></thead>` +
          `<tbody>${rows}</tbody></table></body></html>`,
      );
  });

  // Error handler: clean JSON, never a stack trace.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number } | undefined;
    if (e?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    if (e?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    console.error("[agentgate] unhandled error", err);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}
