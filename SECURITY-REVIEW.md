# AgentGate Seller Service — Adversarial Security Review

**Date:** 2026-11-24

**Scope:** `src/app.ts`, `src/selfVerifier.ts`, `src/callLog.ts`, `src/config.ts`, `src/exa.ts`, `src/agentErrors.ts`, `vendor/noble-ed25519/index.js`
**Assets:** Money (x402 payments) and access control (Self Agent ID gated API)

---

## Findings

### F1 — MEDIUM: Payment gate silently disabled when environment variables are missing

**File:** `src/app.ts:215-225`, `src/config.ts:30-31`
**Category:** Unsafe default / configuration footgun

**Description:**
When `X402_API_KEY` or `SELLER_PAY_TO` is unset (or empty), the payment middleware is not mounted at all (`paymentEnabled` is `false` at line 215, the `chain.push` at line 251 is skipped). The only signal is a `console.warn` message. Any caller that passes Self Agent ID verification is served a full Exa snapshot for free.

**Attack / failure scenario:**
A production deployment with a missing or misconfigured `X402_API_KEY` environment variable (typo, forgotten Doppler binding, Vercel env var scoping error) silently reverts to free-access mode. Every verified request consumes Exa API credits with zero revenue. The operator has no alerting — only a startup log line that scrolls off-screen.

**Fix:**
Add a startup-time check: if the service is in production (`NODE_ENV === "production"`) and either variable is missing, refuse to start (throw or `process.exit(1)`). Alternatively, add a boolean guard in the final handler that returns 503 when payment is required but the gate is unconfigured, rather than silently serving.

---

### F2 — MEDIUM: Unauthenticated public call log exposes business-sensitive data

**File:** `src/app.ts:271-292`
**Category:** Information leakage / missing access control

**Description:**
The `GET /log` endpoint requires no authentication. It renders the last 200 call-log entries as HTML, including:

- Research topics (the exact queries paying customers submitted)
- Verified caller addresses (which agents are using the service)
- Claimed addresses on denied attempts (attacker reconnaissance data)
- Error strings (verification failure reasons)
- Settlement transaction hashes (on-chain financial data, linkable to wallet balances)

**Attack / failure scenario:**
1. **Competitive intelligence:** A competitor monitors `/log` to see what topics other agents are researching — revealing deal pipelines and strategic interests.
2. **Targeted phishing / impersonation:** An attacker learns verified agent addresses from the log and crafts spoofed communications or on-chain interactions targeting those addresses.
3. **Financial tracking:** Settlement hashes let anyone link the seller wallet's on-chain activity, revealing revenue volume and customer identities.

**Fix:**
Gate `/log` behind authentication (a shared secret in an `Authorization` header, or IP allowlist). At minimum, redact or truncate `topic`, `caller`, `claimedAddress`, and `settlement` fields in the public view — show only aggregate stats (count of served/denied/payment-required) without per-call detail.

---

### F3 — LOW: Ed25519 keytype guard is case-sensitive — alternative casings bypass the early-exit

**File:** `src/app.ts:132`
**Category:** Defense-in-depth gap

**Description:**
The header check at line 132 is:
```ts
if (!signature || !timestamp || (keytype === "ed25519" && !agentKey))
```

The comparison `keytype === "ed25519"` is case-sensitive. If a client sends `x-self-agent-keytype: ED25519` or `Ed25519`, the guard does not trigger, and the request proceeds to `verifyAgentRequest` with keytype: "ED25519" and `agentKey: undefined`.

**Attack / failure scenario:**
An attacker sends `keytype: "ED25519"` with no `x-self-agent-key`. The early-exit guard at line 132 is bypassed. The request reaches the SDK. Whether the SDK handles this correctly depends on the SDK's internal casing logic — if the SDK also does a case-sensitive check and falls through to EVM verification, the behaviour differs from the guard's intent (which was to require the agent key for Ed25519).

This is not a direct auth bypass (the SDK should still reject an invalid request), but the guard's purpose — returning a clear "Missing agent authentication headers" error — is defeated.

**Fix:**
Normalize keytype before comparison:
```ts
const normalizedKeytype = keytype?.toLowerCase();
if (!signature || !timestamp || (normalizedKeytype === "ed25519" && !agentKey))
```

---

### F4 — LOW: No IP-based rate limiting — verification-request flooding

**File:** `src/selfVerifier.ts:24`, `src/app.ts` (entire request path)
**Category:** Denial of service

**Description:**
The SDK's rate limit (`VERIFY_RATE_LIMIT_PER_MINUTE = 30`) is keyed by agent address. There is no per-IP or global rate limit. Each verification request triggers an on-chain RPC lookup.

**Attack / failure scenario:**
An attacker sends thousands of requests per second, each with a different fake `x-self-agent-address` and plausible-looking signature/timestamp headers. Every request passes the header-presence check at line 132 and triggers a fresh RPC call. The 15-second verification timeout means up to `15 × concurrency` pending RPC connections. This can:

1. Exhaust the RPC provider's rate limit or quota, causing legitimate verification to fail.
2. Saturate the Node.js event loop with pending promises, degrading service for all callers.

The 16KB body limit provides marginal protection, but the attack payload is in headers, which are essentially free.

**Fix:**
Add IP-based rate limiting upstream (reverse proxy, Vercel Edge middleware, or Express middleware like `express-rate-limit`) with a generous-but-finite cap (e.g., 60 requests/minute/IP). This bounds RPC cost even when agent addresses rotate.

---

### F5 — LOW: Missing security headers on the `/log` HTML page

**File:** `src/app.ts:283-291`
**Category:** Defense-in-depth / browser security

**Description:**
The `/log` endpoint serves an HTML page but sets no security response headers:

- No `Content-Security-Policy` — if the `escapeHtml` function ever misses an edge case (e.g., a future field rendered inside an attribute), there is no CSP to block inline script execution.
- No `X-Content-Type-Options: nosniff` — older browsers might MIME-sniff the response.
- No `X-Frame-Options` / `frame-ancestors` — the page can be iframed by an attacker for clickjacking.

**Attack / failure scenario:**
An attacker iframes `/log` on a malicious page and overlays UI elements to trick a user into clicking on log entries (clickjacking). Impact is low since the page has no interactive actions, but it sets a poor security posture.

**Fix:**
Add headers to the `/log` response:
```ts
res
  .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
  .set("X-Content-Type-Options", "nosniff")
  .set("X-Frame-Options", "DENY")
  .type("html")
  .send(...)
```

---

### F6 — LOW: No secondary payment-verification check in the final handler

**File:** `src/app.ts:252-268`
**Category:** Trust boundary / defense in depth

**Description:**
The final handler (line 252) trusts that the upstream x402 `paymentMiddleware` enforced payment. There is no independent verification. The entire payment enforcement depends on the correctness of the third-party `@x402/express` library — specifically that it never calls `next()` without confirmed payment.

**Attack / failure scenario:**
If a future version of `@x402/express` introduces a bug where `next()` is called on certain error paths (e.g., facilitator timeout, malformed payment header that doesn't throw), requests would reach the Exa handler without payment. The service would then consume Exa credits and serve content for free.

This is a theoretical concern — no known bug exists — but it is a single point of failure on a third-party dependency for the service's revenue model.

**Fix:**
Add a lightweight guard in the final handler: when `paymentEnabled` is true, check for the presence of the `payment-response` response header (which the x402 middleware sets after successful settlement) before serving:
```ts
if (paymentEnabled && !res.getHeader("payment-response")) {
  res.status(402).json({ error: "Payment required" });
  return;
}
```

---

## Checked and Cleared

The following potential issues were investigated and found to be safe:

1. **Gate ordering (verification before payment before service):** The middleware chain at lines 246–269 enforces the correct order. `requireVerifiedAgent` runs before `buildPaymentGate`, which runs before the Exa handler. Every failure path sends a response without calling `next()`, so no request can skip a gate.

2. **Raw body / hash mismatch:** The `express.json` `verify` callback (line 237) captures raw bytes into `req.rawBody` via `Buffer.from(buf)` (a defensive copy). This is passed to the verifier unchanged. If the Content-Type is not `application/json`, the JSON parser doesn't fire, `rawBody` is unset, the verifier receives `""`, and signature verification fails — **fails closed**.

3. **Replay / timestamp attacks:** The service delegates timestamp and replay detection to the Self SDK (`SelfAgentVerifier`). The safe-error list in `agentErrors.ts` includes "Timestamp expired or invalid" and "Replay detected", confirming the SDK implements these checks.

4. **Error-path fail-open:** Every error path in `requireVerifiedAgent` (lines 148–159) and `verifyAgentRequest` (lines 107–114) results in a denial. The `catch` block in the verifier wrapper explicitly returns `{ valid: false }`. Timeouts, RPC failures, and SDK exceptions all deny.

5. **Information leakage in error responses (C1):** The `publicAgentError` allowlist in `agentErrors.ts` only passes through fixed, content-free SDK denial strings. Any unrecognized error (including those containing RPC URLs, API keys, or stack traces) collapses to the generic "Agent verification unavailable, try again later". Full details are logged server-side only.

6. **Stored XSS on `/log`:** The `escapeHtml` function (lines 58–64) escapes `&`, `<`, `>`, and `"`. All user-controllable fields (`topic`, `caller`, `claimedAddress`, `error`, `settlement`) pass through `escapeHtml` before being placed inside `<td>` element content. No user data is placed in HTML attributes. The QA test suite (`qa-probes.test.ts` lines 353–401) verifies this with `<script>` payloads in topics and addresses.

7. **Injection via topic into Exa API:** The topic is passed to `JSON.stringify` at `exa.ts:54`, preventing JSON structure injection. The Exa API is a web search engine — the topic becomes a search query, not a URL or command. The attacker has already paid (via x402) for each request, limiting abuse incentive.

8. **Prototype pollution via `req.body`:** The body is parsed with `JSON.parse` (via Express). Only `.topic` is accessed with optional chaining. No deep property access, no object spreading of the body into other structures. No global prototype pollution risk.

9. **Vendored ed25519 shim (`vendor/noble-ed25519`):** The shim enforces the same input-length contract as the real `@noble/ed25519` v3 (32-byte seeds, 32-byte public keys, 64-byte signatures) with `RangeError` on mismatch. The original W1 bug (silent truncation of over-length public keys) is fixed and regression-tested in `qa-shim.test.ts`.

10. **Self network default:** Defaults to `"mainnet"` (production-safe). Only the exact string `"testnet"` switches to testnet mode. This cannot be accidentally misconfigured to a weaker network.

11. **Concurrent call-log writes:** `appendFile` on JSONL entries (each well under PIPE_BUF / 4KB) is effectively atomic on Linux. The `resolvedByPrimary` map is accessed in Node's single-threaded event loop. No data corruption risk under normal concurrency.

12. **HTTP method restriction:** The route is registered as `app.post("/api/snapshot", ...)`. GET, HEAD, PUT, DELETE, etc. all return 404 (confirmed by QA probe at `qa-probes.test.ts:195–204`).

---

## Summary

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| F1 | **Medium** | `app.ts:215–225` | Payment gate silently disabled when env vars missing |
| F2 | **Medium** | `app.ts:271–292` | Unauthenticated public call log exposes business data |
| F3 | Low | `app.ts:132` | Ed25519 keytype guard case-sensitive — bypasses early-exit |
| F4 | Low | `selfVerifier.ts:24` | No IP-based rate limiting; RPC flooding via fake agents |
| F5 | Low | `app.ts:283–291` | Missing security headers on /log HTML page |
| F6 | Low | `app.ts:252–268` | No secondary payment-verification in handler (trust in 3P lib) |

No critical or high-severity findings. The codebase shows evidence of prior QA hardening: deny-by-default error handling, error message sanitization, XSS escaping, body-size limits, timeout enforcement, and ed25519 length contract enforcement are all well-implemented. The main risks are operational (misconfigured payment gate) and exposure-related (public call log).
