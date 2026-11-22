# AgentGate — seller service

The paid endpoint from AgentGate (see `../spec/`): a prospect research
snapshot service that only serves **Self Agent ID**-verified agents and
charges via **x402** on Celo mainnet.

## Flow

`POST /api/snapshot` with body `{ "topic": "<company or topic>" }`:

1. **Verify** — the caller must send Self Agent ID signed headers
   (`x-self-agent-signature`, `x-self-agent-timestamp`,
   `x-self-agent-address`). Verification is deny-by-default: missing
   headers, a bad signature, a replay, an unregistered agent, an expired
   proof, a chain read failure or a timeout all answer
   `401 { "error": "<machine-readable reason>" }`. Nothing is served and
   no payment is requested.
2. **Pay** — verified callers get `402` with x402 payment requirements
   (0.01 USDC on Celo mainnet, settled through Celo's native facilitator)
   until payment settles.
3. **Serve** — after settlement, the service returns
   `{ topic, summary, keyFacts[], sources[{ title, url }] }` generated
   from live Exa search results.

Every attempt is appended to an append-only call log (`data/calls.jsonl`,
gitignored) and rendered at `GET /log`. `GET /health` returns 200.

## Run locally

```bash
npm install
cp .env.example .env   # fill in EXA_API_KEY (and the x402 pair to enable the payment gate)
npm run dev            # http://localhost:4021
npm test               # vitest — gate, validation, log and 402 tests
npm run typecheck
```

Without `X402_API_KEY` + `SELLER_PAY_TO` the service still boots (with a
loud warning) and the deny path works, but verified requests are served
without payment — that mode exists so the gate can be developed before
the facilitator key exists (TASKS T1.4).

## Deploy

Vercel project `agentgate-seller`, root = this directory. `api/index.ts`
is the function entry; `vercel.json` rewrites all routes to it.
Production env: `EXA_API_KEY` (from Doppler), plus `X402_API_KEY` and
`SELLER_PAY_TO` once the facilitator key has been created.

Two packaging notes, both forced by the Vercel runtime:

- Relative imports carry explicit `.js` extensions — Vercel emits plain
  Node ESM for the function, which rejects extensionless specifiers.
- `@noble/ed25519` is vendored as a CommonJS shim (`vendor/noble-ed25519`,
  wired in as a `file:` dependency). The real package (v3) is ESM-only,
  `@selfxyz/agent-sdk` loads it with `require()`, and Vercel's function
  loader rejects `require()` of ES modules (`ERR_REQUIRE_ESM`). The shim
  implements exactly the surface the SDK uses (`hashes`, `getPublicKey`,
  `signAsync`, `verifyAsync`) on `node:crypto`, and is byte-compatible
  with the real package (checked against a test vector signed by it).
  Everywhere else (local dev included) behaviour is identical.
