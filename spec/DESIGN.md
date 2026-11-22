# AgentGate — DESIGN

All sponsor mechanics below are from spec/research.md (verified against official docs, 22 Nov 2026). Items marked UNVERIFIED there stay out of the critical path.

**Architecture** — three components, no custom contracts:
1. **Seller service** (Express + TypeScript, deployed on Vercel): one paid endpoint. Request flow: Self Agent ID verification first (deny-by-default) → x402 payment gate → snapshot generation (Exa) → response. Every attempt is appended to a call log, exposed on a simple public log page so judges can see allow and deny entries.
2. **Buyer agent** (Node CLI, TypeScript, viem): owns the agent wallet. Registers the agent on ERC-8004, signs its Self Agent ID headers, pays via @x402/fetch, and writes a run report per session. All self-sent transactions go through the attribution-tag wrapper.
3. **Agent Vault** (hosted MCP, OAuth): holds the website credential and the demo agent card. The buyer agent uses it for the website sign-in leg and the spending-limit demonstration. It never touches the x402 payment (see Decisions).

**Data model**
- Call log entry: timestamp, caller address, verified (bool + any returned attributes), outcome (denied / payment-required / served), amount + settlement tx hash when paid, snapshot topic. Stored as an append-only JSON file in the service (demo scale; no database).
- ERC-8004 registration file: hosted JSON (name, description, services[], registrations[], x402Support) at a stable public URL; the agent ID is backfilled after registration.
- Run report: Markdown per buyer session — purchases, amounts, tx hashes, deny/cap events.

**API contracts**
- `POST /api/snapshot` — body `{ "topic": "<company or topic>" }`, caller identified by the Self Agent ID signed headers (`x-self-agent-signature`, `x-self-agent-timestamp`, `x-self-agent-address`).
  - Unverified or invalid → `401` with a machine-readable `error` string from the verifier; no payment requested, no work done.
  - Verified, unpaid → `402` with x402 payment requirements (explicit price object: amount, asset, EIP-712 `extra.name/version`).
  - Verified + settled → `200` with the snapshot JSON (summary, key facts, sources).
- `GET /log` — public HTML view of the call log (verification results visible, per Track 3's "identity shown" requirement).

**Key decisions**
- **Seller framework: Express** — the x402 v2 seller packages are `@x402/express` / `@x402/hono` only (legacy `x402-express` does not work on Celo); Express also gives raw-body control, which the Self verifier needs (it hashes the raw body — keep `req.rawBody`). SPEC's "Next.js" wording is superseded by this; the seller is a standalone API service, not a web app.
- **Payment asset: USDC on Celo** (0xcebA…118C, 6dp, EIP-3009) at a demo price per snapshot; the price object is always explicit — a bare "$0.01" string silently resolves to the wrong asset.
- **x402 payment is made from the agent's own wallet**, not Agent Vault: Celo's own Agent Vault page states the vault docs describe no Celo/x402 support and that it does not move money. Agent Vault covers Track 2's sign-in requirement and hosts the spending-limit demo (its per-card USD limits are enforced on every fill; a breach returns `limit_reached`).
- **Chain access via Chainstack** (Pintu's subscription) as the buyer agent's RPC; viem builds transactions so fee abstraction (gas in stablecoins) stays available if CELO runs low.
- **Attribution**: `@celo/attribution-tags` viem extension on every agent-sent transaction (ERC-8004 registration included). x402 settlements carry no tag — attribution for those is via the registered PayTo address, per the event rules.
- **Loops skill: NOT installed.** Its listed source repo returns 404 and the per-event skill file is server-generated at install time, so it cannot be pre-audited (research.md §7). The submission is filed through the Loops House web form instead.
- **Secrets**: wallet key and API keys only in env/Doppler; the x402 facilitator key is created by Pintu at x402.celo.org (GitHub sign-in — the mainnet free-credit grant is forfeited permanently if skipped).

**Risks**
1. **Self Agent ID registration is a human step** — the agent's identity is minted when Pintu scans a QR with his passport in the Self app. De-risk: schedule it at the start of Slice 2; Slice 1 (deny path + payment gate) does not depend on it.
2. **Agent Vault × Track 2 wording conflict** — the track text implies the vault wallet can pay x402; sponsor docs say otherwise. De-risk: the design satisfies every other Track 2 requirement literally (sign-in via vault, x402 via Celo facilitator, a vault spending limit shown being hit, agent never sees credentials) and the README states the payment route plainly.
3. **ERC-8004 gas cost UNVERIFIED** — de-risk: fund the agent wallet with a small amount of CELO plus stablecoin before registering; fee abstraction allows stablecoin gas as a fallback.
