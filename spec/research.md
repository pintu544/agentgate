# AgentGate — Integration Research

**Event:** Agents Open for Business (Celo / Loops House), Tracks 3 (Self Agent ID) + 2 (Agent Vault)
**Research date:** 22 Nov 2026
**Method:** Official documentation only — docs.celo.org, docs.self.xyz, docs.agentvault.io (as mirrored by Celo docs), x402.celo.org, and the sponsors' GitHub repos. Anything that could not be verified from an official source is marked **UNVERIFIED**.

---

## 1. Self Agent ID (Self, self.xyz)

**What it is.** An on-chain identity registry on Celo that binds an agent's signing key to a zero-knowledge proof that one real, unique human stands behind it. The human scans a passport/ID in the Self app; the ZK proof is generated on the phone (no personal data leaves the device); the Self Hub verifies the proof on Celo; the registry mints a **soulbound ERC-721 NFT** linking the agent's key to the human's unique nullifier. It implements the ERC-8004 registries and adds a proof-of-human extension. (Source: https://docs.celo.org/build/agents/self-agent-id, 22 Nov 2026)

**Contracts (Celo mainnet, chain 42220).** (Source: https://docs.celo.org/build/agents/self-agent-id, 22 Nov 2026)
- SelfAgentRegistry (identity + proof-of-human): `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944`
- SelfReputationRegistry: `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4`
- SelfValidationRegistry: `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577`
- These are Self's own deployments, separate from the reference ERC-8004 registries (`0x8004A169…`); an agent can be registered in both.

**What the agent presents — signed HTTP headers, not a bearer token.** The agent signs every outbound request with its key. The digest signed is `keccak256(timestamp + METHOD + pathWithQuery + keccak256(body))`, where METHOD is uppercase and `pathWithQuery` is path + query string (no host). Headers: (Source: https://docs.self.xyz/docs/agent-id/sdk-integration, 22 Nov 2026)
- `x-self-agent-signature` — EIP-191 `personal_sign` of the 32-byte digest (ECDSA agents), or an Ed25519 signature of the same digest
- `x-self-agent-timestamp` — Unix milliseconds
- `x-self-agent-address` — the agent's EVM address (ECDSA agents; informational)
- Ed25519 agents instead send `x-self-agent-keytype: ed25519` and `x-self-agent-key` (public key, `0x` + 64 hex)

**SDKs (official).** (Sources: https://docs.self.xyz/docs/agent-id/sdk-integration and https://docs.celo.org/build/agents/self-agent-id, 22 Nov 2026)
- TypeScript: `@selfxyz/agent-sdk` (v0.3.1, Node 18+); defaults to mainnet, pass `network: 'testnet'` for Celo Sepolia (11142220). Ships the `self-agent` CLI.
- Python: `pip install selfxyz-agent-sdk` (package `selfxyz-agent-sdk`, imports `self_agent_sdk`).
- Rust: `cargo add self-agent-sdk`.
- Hosted REST API base: `https://agent-api.self.xyz` (override with `SELF_AGENT_API_BASE`).
- The signing protocol is language-agnostic — all SDKs produce identical signatures (Source: https://pypi.org/project/selfxyz-agent-sdk/, 22 Nov 2026).

**Agent side.** `new SelfAgent({ privateKey, network })`; `agent.fetch(url, init)` is `fetch()` with the three signed headers added; `agent.signRequest(method, url, body?)` returns headers only; `agent.getInfo()` returns `agentId`, `isVerified` (= `hasHumanProof && isProofFresh`), `proofExpiresAt`, `nullifier`, credentials access via `getCredentials()`, and `getVerificationStrength()` (0–100, 100 = passport). Ed25519 agents use `Ed25519Agent`. (Source: https://docs.self.xyz/docs/agent-id/sdk-integration, 22 Nov 2026)

**Service side — the check.** Use `SelfAgentVerifier` (builder: `SelfAgentVerifier.create().network(...).requireAge(18).sybilLimit(...).build()`, or `SelfAgentVerifier.fromConfig({...})`). Two integration shapes: (Source: https://docs.self.xyz/docs/agent-id/sdk-integration, 22 Nov 2026)
- Express middleware: `app.post('/api/data', verifier.auth(), handler)` — rejects failing requests before the handler runs; on success `req.agent` holds `address`, `agentKey`, `agentId`, `agentCount`, `nullifier`, optional `credentials`. **Gotcha:** the signature covers the exact body bytes — keep them as `req.rawBody` (via `express.json({ verify })`); a body with no raw body yields a 500.
- Framework-free: `verifier.verify({ signature, timestamp, method, url, body, keytype?, agentKey? })` → `{ valid, agentAddress, agentKey, agentId, agentCount, nullifier, error?, credentials?, proofExpiresAt?, isExpiringSoon? }`.
- Signature-free check: `verifyAgent(agentKey, { network })` → `{ verified, agentId, expiresAt }` or `{ verified: false, reason: "NOT_REGISTERED" | "NO_HUMAN_PROOF" | "PROOF_EXPIRED", reauthUrl? }`.
- Verification order: timestamp → signature → replay → on-chain `isVerifiedAgent` + `isProofFresh` → provider → sybil limit → credentials → rate limit. Manual verification without the SDK requires `isVerifiedAgent(agentKey)` **and** `isProofFresh(getAgentId(agentKey))` on the registry.

**Configurable rules (builder options, defaults in brackets).** `.requireAge(18|21)` [off], `.requireOFAC()` [off — reads `credentials.ofac[0]` only], `.requireNationality(...ISO alpha-3)` [off], `.requireSelfProvider()` [on], `.sybilLimit(n)` [1; 0 = unlimited], `.rateLimit({ perMinute, perHour })` [off, in-memory sliding window], `.replayProtection()` [on; 10,000-entry per-process cache], `.maxAge(ms)` [5 min], `.cacheTtl(ms)` [1 min]. Note: the verifier default sybil limit is 1, but the deployed registry allows 10 agents per human on Celo mainnet (no cap on Sepolia) — set `.sybilLimit()` to your own policy. (Source: https://docs.self.xyz/docs/agent-id/sdk-integration, 22 Nov 2026)

**What a deny looks like.** The Express `auth()` middleware answers with a JSON `error` string and status: (Source: https://docs.self.xyz/docs/agent-id/sdk-integration, 22 Nov 2026)
- `401` with one of: `Missing agent authentication headers`, `Timestamp expired or invalid`, `Invalid signature`, `Replay detected`, `Agent not verified on-chain`, `Agent's human proof has expired`, `Agent was not verified by Self — proof provider mismatch`, `Human has N agents (max M)`, `Agent's human does not meet minimum age (required: X, got: Y)`, `Agent's human did not pass OFAC screening`, `Nationality "X" not in allowed list`
- `429` — `Rate limit exceeded (N/min|hr)` with `retryAfterMs`
- `503` — `Agent verification unavailable, try again later` (chain unreadable; `verify()` throws in this case, so answer 503)
- Verifiers reject timestamps more than 5 minutes from their clock and reject a signature already seen (replay protection). Requests older than 300 s are rejected by default. (Sources: https://docs.self.xyz/docs/agent-id/sdk-integration; https://docs.celo.org/build/agents/self-agent-id, 22 Nov 2026)

**Registration.** A browser handoff: the CLI/SDK creates a session, the human scans a QR code with the Self app, the proof is verified on-chain, the NFT is minted. CLI ships with the SDK (`self-agent register init/open/status`); programmatic equivalent: `requestRegistration({ mode, network, disclosures? })` → session with `scanUrl`, `waitForCompletion()`, `exportKey()` (EVM modes, within 30 min). Modes: `linked`, `wallet-free`, `ed25519`, `ed25519-linked`, `privy`, `smartwallet` (gasless on mainnet) — all produce the same soulbound NFT. Mainnet accepts real passports/IDs only; testnet (Celo Sepolia) accepts mock documents. Proofs expire at `min(document expiry, registration + 365 days)`; renew in place with `requestProofRefresh`. (Sources: https://docs.celo.org/build/agents/self-agent-id; https://docs.self.xyz/docs/agent-id/sdk-integration, 22 Nov 2026)

**Design fit.** This is exactly the Track 3 gate: our service mounts `verifier.auth()` (or calls `verifier.verify`) before any paid work, configures e.g. `requireAge(18)`/sybil policy, and the deny is a clean 401 + machine-readable `error` — both the allowed and denied call are trivially demoable and loggable.

---

## 2. Agent Vault (Self Labs)

**What it is exactly.** A card-and-login vault for agents, built by Self Labs (the team behind Self). The account holder stores cards, website logins and addresses in a dashboard (app.agentvault.io). The agent never holds a real card number or password: it receives **mock tokens** (e.g. `av_card_1_number_u7x2k`) and fills checkout/sign-in forms inside a browser that runs inside Agent Vault's proxy; at each fill, the proxy checks the holder's rules, swaps the token for the real value, and types it into the merchant page. A token typed anywhere outside Agent Vault's browser is a meaningless string. A login fills only on the site it was saved for. (Source: https://docs.celo.org/build/agents/agent-vault, 22 Nov 2026)

**How sign-in works without the agent seeing the password.** The agent drives the proxied browser via tools/SDK and calls the login fill with tokens; detokenisation happens inside the proxy at type-time. The agent can never read back a filled value (`page.evaluate` is disabled for agent sessions). Challenges (3-D Secure, OTPs, CAPTCHAs) are handed off to the account holder — Agent Vault does not solve them. Agent-created accounts go through the vault too: `create_login` makes the vault mint the password; the agent never generates one. (Source: https://docs.celo.org/build/agents/agent-vault, 22 Nov 2026)

**Integration shapes.** (Source: https://docs.celo.org/build/agents/agent-vault, 22 Nov 2026)
- Hosted MCP server: `https://mcp.agentvault.io/mcp` — OAuth sign-in, no API key; 29 tools + `get_pending_result` (discover: `get_token_catalog`, `get_checkout_recipes`; accounts: `create_login`, `wait_for_signup_approval`, …; drive: `open_page`, `click`, `press`; fill: `fill_checkout`, `fill_login`; observe: `observe_page`, `snapshot_page`, `detect_challenge`; finish: `get_session_outcome`, `get_run_report`, `close_session`).
- Self-run MCP server: `@agentvault/mcp` (local stdio, API key in env).
- Playwright SDK: `@agentvault/playwright` — replaces Playwright's `chromium` so every action runs in the proxy. **Not on npm** — installed from a URL Agent Vault hosts. Requires env `SELF_AGENT_PAY_API_KEY`, `SELF_AGENT_PAY_PROXY_URL`, `SELF_AGENT_PAY_API_URL` (SDK runs server-side, Bun or Node 20+). Errors throw `SelfAgentPayError` with a stable `code`.
- HTTP API (everything except driving the browser): `GET /v1/tokens`, `GET /v1/recipes` (no auth), `POST /v1/recipes`, `POST /v1/logins/requests`, `GET /v1/logins/requests/{id}`, `POST /v1/logins/username`, `POST /v1/logins/password` — base `https://api.agentvault.io` (Source: https://docs.agentvault.io/reference/limits via search index; endpoint list per https://docs.celo.org/build/agents/agent-vault, 22 Nov 2026).

**Spending limits / rules — configuration and enforcement.** The holder gives each agent an **agent card**: a rule set on one of their saved cards, checked by the proxy on **every fill**. (Sources: https://docs.celo.org/build/agents/agent-vault; https://docs.agentvault.io/reference/limits, 22 Nov 2026)
- Limits are per agent card, in USD, all windows **rolling**: per transaction [all plans; starter default $75], per day [Plus/Enterprise; $100], per week [all plans; $200], per rolling 30 days [all plans; $500]. Foreign-currency totals are converted at a daily reference rate + 3% safety buffer before checking.
- Merchant rules: block named sites (all plans); allowlists Enterprise only. Approval rule: pause purchases above a holder-chosen amount until approved. Kill switch: "Pause all agents" on the dashboard Overview stops every agent at once.
- A breach refuses that fill with error code `limit_reached`; with **auto-pause on limit exceeded** (`autoPauseOnLimit`, on by default for dashboard-created cards) the card stops until the holder resumes it. Other refusal codes: `plan_quota_reached`, `destination_unauthorized` (fill waits for holder approval, then fails without it), `cvv_entry_required` (CVV is never stored; holder must type it live).
- Plan quotas (production only; preview/dev/test/staging are unmetered and enforce only the per-transaction cap): payments per rolling 30 days — Free 5, Plus 100, Enterprise unlimited; agent cards — Free 1, Plus 5, Enterprise unlimited. Proxy sessions: 15 min idle / 60 min hard timeout.
- Webhooks per agent card (Plus/Enterprise): signed JSON POSTs, verify `X-AgentPay-Signature` with the card's `whsec_…` secret; events `card_fill`, `denied_fill`, `limit_threshold`, `auto_pause`, `approval_required`. Treat as alerts, not a ledger.

**⚠️ Agent Vault and x402 — official docs contradict the track brief.** Celo's official Agent Vault page states, verbatim in substance: "It is not a Celo protocol, and **its documentation describes no Celo, stablecoin or x402 support**. For agents that pay onchain, see x402 and MPP." Also: "**Agent Vault does not move money.** The merchant sees an ordinary card payment" and "Its documentation describes no blockchain component, so **it gives the agent no wallet or onchain identity**." (Source: https://docs.celo.org/build/agents/agent-vault, 22 Nov 2026)
- Therefore: there is **no documented "Agent Vault agent wallet" that makes x402 payments**. The Track 2 requirement "at least one x402 payment through Celo's native facilitator (the Agent Vault agent wallet can make it)" is **UNVERIFIED / contradicted by the sponsor's own docs** as of 22 Nov 2026.
- Design consequence: build the x402 leg from a wallet we control (the buyer flow in §3, e.g. the same EOA that holds the Self Agent ID, paying with `@x402/fetch`), and use Agent Vault strictly for the website sign-in leg + the spending-limit rule. Do not architect around an Agent Vault on-chain wallet existing.

---

## 3. x402 on Celo

Primary source, read in full 22 Nov 2026: https://x402.celo.org/skill.md (the official integration skill published by Celo Core Co), plus https://x402.celo.org/ (dashboard/pricing page).

**Shape of the protocol.** Server answers a request with HTTP `402 Payment Required` and a machine-readable price; the client signs a stablecoin payment; a **facilitator** verifies the signature and settles it on-chain. The buyer pays no gas — settlement gas is paid by the facilitator. Funds move buyer → seller `payTo` directly inside the token contract; the facilitator never holds funds. Scheme is `exact` (fixed price per request).

**Facilitator URLs.**
- Dashboard: `https://x402.celo.org`
- Mainnet facilitator API: `https://api.x402.celo.org`
- Testnet (Celo Sepolia) facilitator API: `https://api.x402.sepolia.celo.org`
- One API key works on both networks. Live capabilities: `GET /supported` on either host.

**Seller integration (the primary case).** Use the official x402 **v2** scoped packages — **not** the legacy `x402-express` / `x402-fetch` (they have no Celo entry in their network enum and will not work). Verified against `@x402/*@2.23`:
- Install (Hono): `npm i @x402/hono @x402/core @x402/evm viem` (swap `@x402/hono` → `@x402/express` for Express).
- Build an `HTTPFacilitatorClient` from `@x402/core/server` pointed at the facilitator URL, with `createAuthHeaders` returning `{ "X-API-Key": process.env.X402_API_KEY }` for `verify`, `settle` and `supported`. The key goes **only** to the facilitator, as `X-API-Key`, only on middleware→facilitator requests; never expose it to a browser or buyers. Without it, settlement is rejected (`401` metering gate). `/verify` works without a key but is IP-throttled (60/min shared per IP); a key moves it to your own 60/min bucket and `/verify` is never charged a credit.
- Build `new x402ResourceServer(facilitator)`, `server.register("eip155:*", new ExactEvmScheme())` (from `@x402/evm/exact/server`), then `app.use(paymentMiddleware(routes, server))` — routes first, then server. `payTo` and `price` live inside each route's `accepts`.
- Price must be the explicit object `{ amount: "10000", asset: USDC, extra: { name: "USDC", version: "2" } }` — amounts are strings in the token's base units. **Do not use a bare `price: "$0.01"` on Celo**: it silently resolves to USDC via the default-asset table, whatever you meant. `extra.name` is the token's EIP-712 domain name, **not** the symbol (USDT signs as `Tether USD`); the table in the skill doc is the only source — `eip712Domain()` reverts on every listed token.
- Runtime: no payment → `402` with requirements in the base64 `payment-required` response header (body `{}`); client retries with an `X-PAYMENT` header; middleware calls facilitator `/verify` then `/settle`; on success the handler runs and the response carries an `X-PAYMENT-RESPONSE` / `payment-response` header with settlement details incl. tx hash. Settlement returns after 1 confirmation (~2–3.5 s end-to-end typical).
- Env: `X402_API_KEY`, `X402_NETWORK` (`testnet` | `mainnet`), `SELLER_PAY_TO`.
- Runnable official example (seller + buyer, Celo Sepolia): https://github.com/celo-org/x402-celo-example

**Tokens that settle on Celo mainnet (`eip155:42220`) via this facilitator** (authoritative table in the skill doc):
- EIP-3009 (`transferWithAuthorization`), 6 decimals: **USDC** `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (EIP-712 name `USDC`, version `2`); **USDT** `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (name `Tether USD`, version `1`); **USAT** `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771` (name `Tether America USD`, version `1`).
- Permit2, 18 decimals: wARS, wBRL, wMXN, wCOP, wPEN, wCLP (Ripio wrapped local currencies) — route must add `assetTransferMethod: "permit2"` to `extra` **and** declare `extensions.eip2612GasSponsoring` on the route, or first-time wallets get `412 permit2_allowance_required`.
- Permit2, 6 decimals: cNGN `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` — the exception: no EIP-2612, so a first-time payer must send `approve(Permit2, amount)` themselves and pay that gas once (Permit2 = `0x000000000022D473030F116dDEE9F6B43aC78BA3`).
- Testnet: USDC only (`0x01C5C0122039549AD1493B8220cABEdD739BC44E` on Celo Sepolia). Testnet USDC from https://faucet.circle.com; testnet CELO from https://faucet.celo.org.
- ⚠️ Fee-currency adapter trap: USDT/USAT/USDC each have an 18-decimal fee-currency adapter reporting the same name/symbol (e.g. USDT adapter `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72`). Quoting a price against an adapter address is a 10^12 error — always use the token addresses above.

**Seller API key and free credits.** (Sources: https://x402.celo.org/skill.md; https://x402.celo.org/, 22 Nov 2026)
- A human (not the agent) creates the key once: open https://x402.celo.org, connect an EVM wallet, **Create API key**, sign a message (no gas, no transaction). The key looks like `x402_…`, is shown **once**, and is provided to the project as env `X402_API_KEY`. Lost key → dashboard "Regenerate" (invalidates the old key; credits/balance preserved).
- **Free credits: new accounts get 1,000 credits on testnet and up to 100 on mainnet.** The mainnet grant may require **Sign in with GitHub** at key creation (one per GitHub account); choosing "Skip" gives testnet credits alone and GitHub cannot be added to that key later. One free credit covers the facilitator's full charge for one settlement.
- After credits: each settlement is charged **gas at cost + 0.3% of the payment value** (gas only for assets with no USD price — wARS/wMXN/wPEN/wCLP always; wBRL/wCOP/cNGN while their feed is stale), debited from a prepaid balance topped up by depositing USDC/USDT/USAT on the dashboard (credited dollar-for-dollar; deposits are final, non-withdrawable). Failed settlements are refunded in full. When neither credits nor balance cover a settlement, `/settle` returns `402` with `insufficient_credits`. Exact live pricing is served at `GET /api/config` under `pricing`. Retries are safe with an `X-Idempotency-Key`.

**Buyer / client flow (programmatic payment).** (Source: https://x402.celo.org/skill.md, 22 Nov 2026)
- Install: `npm i @x402/fetch @x402/evm viem`. Build an `x402Client`, `client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: "https://forno.celo.org" }))`, then `const payFetch = wrapFetchWithPayment(fetch, client)` — it handles the whole 402 → sign → retry loop automatically. One-call form: `wrapFetchWithPaymentFromConfig`. The buyer needs a funded wallet (the priced asset on the target network) and **no facilitator API key** and **no native gas** on the hosted facilitator (EIP-3009 assets settle from the signature; Permit2 assets via the facilitator-sponsored EIP-2612 permit, when the route declares the extension).
- The `{ rpcUrl }` signer matters: with a bare account the client can't read allowance/permit nonce and fresh wallets fail Permit2 payments with `412`.
- **Spend controls (client-side, enforced before signing):** the stock client refuses any asset outside `@x402/evm`'s default-asset table (Celo mainnet: USDC, USDT, USAT as of 2.26.0) and caps every default asset at **$1 per payment** (`DEFAULT_MAX_AMOUNT_PER_PAYMENT`). Set them via `client.setSpendControls({ allowedAssets: [{ network, asset, maxAmountPerPayment: "<atomic units>" }], maxAmountPerPayment: "$50" })` — **not** via the constructor (a config object passed to `new x402Client(config)` is silently ignored). Permit2 assets (wARS…cNGN) are refused unless explicitly opted in via `allowedAssets` with an atomic cap. Spend controls exist from `@x402/core` 2.23.0.

**Attribution note.** x402 settlements on Celo currently carry **no attribution tag** (see §5) — for this event, sellers register their PayTo address instead, per the event FAQ.

---

## 4. ERC-8004 on Celo

Sources: https://docs.celo.org/build-on-celo/build-with-ai/8004 and https://github.com/erc-8004/erc-8004-contracts (both 22 Nov 2026).

**Registries.** Three registries: Identity (ERC-721 NFT per agent), Reputation (feedback/ratings), Validation (third-party attestation hooks — still under active spec revision).

**Contract addresses.**
- Celo mainnet Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Celo mainnet Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- Celo Sepolia Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`; Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- (Same mainnet addresses as Ethereum mainnet — vanity deployments. Note: Self Agent ID in §1 is a *separate* deployment of the same standard with proof-of-human; the event's "ERC-8004 identity" requirement can be satisfied on the reference registry, and Self registration additionally gives the Track 3 gate.)

**Registration call and agentURI metadata.**
- `register()` on the Identity Registry mints the agent's ERC-721 NFT and assigns an `agentId`; it sets the agent's wallet (`agentWallet` metadata) to the transaction sender automatically. Read the agent ID from the **`Registered` event** on the receipt — the value `register()` returns is `_lastId` at simulation time and is wrong if someone else registers first.
- `agentURI` (the NFT's `tokenURI`) points to a **registration file**: JSON hosted anywhere fetchable — any HTTPS URL, IPFS, or a `data:` URI stored on-chain; the spec does not mandate a path. Recommended shape: `type`, `name`, `description`, `image`, `services` (endpoint list; names are examples, not a closed set — `web`, `A2A`, `MCP`, `OASF`, `ENS`, `DID`, `email`, `wallet`), `registrations` (list of `{ agentRegistry, agentId }` binding the file back to the on-chain entry), `supportedTrust` (optional), and **`x402Support: true`** if the endpoints accept x402 payments.
- Order of operations: publish the file *without* `registrations` → register → read the ID from the `Registered` event → update the file with the ID → if the URI changed (IPFS/`data:`), point the registry at it with `setAgentURI(agentId, newURI)`. `setAgentURI` also swaps in a new file later; set `"active": false` in the file to retire a service.
- `setAgentWallet()` changes the agent wallet later, with a signature (EIP-712 / ERC-1271 proof) from the new wallet; transferring the NFT clears `agentWallet`.
- Reputation: `giveFeedback(...)` (8 positional args; `value` is `int128` with `valueDecimals` fixing scale; self-feedback from owner/operators reverts with `Self-feedback not allowed`), `readAllFeedback`, `getSummary` (needs an explicit client-address list — pass a tag, unfiltered summaries are paddable).

**Cost.** No official figure for the gas/CELO cost of `register()` was found in the Celo docs or the contracts repo — **UNVERIFIED**. What is verified: gas for `register()`/`setAgentURI()` can be paid in a stablecoin via Celo fee abstraction (see §6), so no CELO balance is strictly required (Source: https://docs.celo.org/build-on-celo/build-with-ai/8004, 22 Nov 2026). Budget-wise it is a single NFT mint + URI storage on a low-fee chain; measure on Celo Sepolia first.

---

## 5. Attribution tags (ERC-8021)

Sources: https://github.com/celo-org/attribution-tags — `BUILDERS.md` and `sdk/README.md` (the docs.celo.org tagging page itself failed to load during research; the celo-org repo is the canonical SDK source). The helper library is the npm package **`@celo/attribution-tags`** (MIT), which wraps `ox/erc8021`. Our issued code: `celo_b4690008b08e`.

**How it works.** ERC-8021 appends a small attribution suffix to the **end of transaction calldata**. The EVM discards trailing bytes, so the suffix never changes execution semantics — it only makes the transaction identifiable. It goes in the code that builds and sends transactions (frontend or agent backend), **not** in a smart contract, and it cannot be added later — a transaction sent without the tag can never be credited.

**Exact byte format — Schema 0 (the default, `toDataSuffix`).** Reading left-to-right at the end of calldata: (Source: sdk/README.md "Wire format", 22 Nov 2026)

```
[code : N bytes][length : 1 byte][schema : 1 byte = 0x00][marker : 16 bytes]
marker = 0x80218021802180218021802180218021   (exported as ERC_8021_MARKER)
```

- The code field is the raw ASCII of the code string; multiple codes are comma-delimited in the same field.
- The length byte is the length of the code field (multi-code comma-joined total capped at 255 bytes).
- Codes must match `[a-z0-9_]`, 1–32 bytes each; the SDK rejects empty/overlong/out-of-charset codes.
- **Schema 2** (role-based, `toRoleDataSuffix({ app, wallet, service })`) replaces the code field with a CBOR map using keys `a`/`w`/`s`, a **2-byte** length, and schema byte `0x02`. It is for facilitators/payment infrastructure that submit transactions for others — apps tagging their own transactions use Schema 0.
- Derived example for our code (computed from the documented format; verify with the SDK before relying on it): `celo_b4690008b08e` is 17 ASCII bytes → suffix = `0x` + hex("celo_b4690008b08e") + `11` (length 17) + `00` (Schema 0) + `80218021802180218021802180218021` (marker) = `0x63656c6f5f62343639303030386230386511008021802180218021802180218021` (35 bytes total).

**How to append it — helper library.** `npm install @celo/attribution-tags viem` (viem is an optional peer, needed for `verifyTx`/`withAttribution`). Exports: (Sources: BUILDERS.md; sdk/README.md, 22 Nov 2026)
- `withAttribution(code)` — **recommended**: a viem wallet-client extension (`.extend(withAttribution('celo_b4690008b08e'))`) that tags every `sendTransaction`/`writeContract` (and `*Sync` variants) the client makes, including plain value transfers; merges with an existing Schema 0 suffix instead of double-tagging. On viem ≥ 2.45, alternatively pass `dataSuffix: toDataSuffix(code)` to `createWalletClient` (also covers `sendCalls`).
- `toDataSuffix(code | [codes])` — encode the suffix for a single call; for contract calls, `concat([encodeFunctionData(...), tag])`, or pass `dataSuffix: tag` in wagmi's `useWriteContract`.
- `verifyTx({ client, hash })` → `{ codes, schemaId } | null` (never throws; handles ERC-4337 `handleOps` bundles, returning the smart-account `sender` to credit). `fromDataSuffix(data)` decodes offline.
- `codeFromHostname(hostname)` / `codeFromRepo("owner/repo")` — deterministic self-derived codes (`"celo_"` + first 12 hex chars of SHA-256). ⚠️ **Do not substitute a derived code for our issued one**: BUILDERS.md warns that leaderboards/reward programs only credit the *assigned* code, and a self-derived code "will silently never be credited". Our code `celo_b4690008b08e` must be passed verbatim; after the first tagged transaction, close the loop with `verifyTx` and confirm the on-chain codes include it.

**Layering rule.** Only add codes that represent your own app. Platform codes (`minipay`, `proofofship`) are added by the platform's wallet layer, never by the app.

**x402 caveat (important for this build).** The hosted Celo x402 facilitator does **not** yet write Schema 2 tags (implementation under review upstream, x402-rs/x402-rs#99), so **x402 settlements on Celo currently carry no attribution tag**. Declaring your app code in your `402` responses via the x402 `builder-code` extension is harmless now and will be picked up automatically once it ships. For the hackathon, counted x402 activity is therefore attributed via the registered **PayTo address**, while our own wallet's direct transactions (e.g. ERC-8004 registration, any direct transfers) must carry the Schema 0 tag with `celo_b4690008b08e`. (Source: BUILDERS.md "The layering rule", 22 Nov 2026)

---

## 6. Celo mainnet facts

- **Chain ID:** 42220 (CAIP-2 `eip155:42220`, hex `0xa4ec`). Testnet is Celo Sepolia, 11142220. Public RPC: `https://forno.celo.org` (mainnet), `https://forno.celo-sepolia.celo-testnet.org` (Sepolia). (Sources: https://x402.celo.org/skill.md; https://docs.celo.org/build/agents/self-agent-id, 22 Nov 2026)
- **Token contracts on Celo mainnet:**
  - **cUSD — now branded USDm (Mento Dollar)**, same contract: `0x765DE816845861e75A25fCA122bb6898B8B1282a`, **18 decimals**. (Source: https://github.com/celo-org/celopedia-skills/blob/HEAD/skills/celopedia-skill/references/contracts.md, sourced from docs.celo.org, 22 Nov 2026)
  - **USDC (Circle)**: `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`, 6 decimals. (Source: https://x402.celo.org/skill.md token table, 22 Nov 2026)
  - **USD₮ (Tether)**: `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`, 6 decimals. (Source: https://x402.celo.org/skill.md token table, 22 Nov 2026)
  - CELO itself also exists as an ERC-20 at `0x471EcE3750Da237f93B8E339c536989b8978a438` (token duality). (Source: celopedia-skills contracts reference, 22 Nov 2026)
- **Gas — fee abstraction (CIP-64).** Gas does **not** require CELO. Fee abstraction is a protocol feature (not a paymaster/relayer): a transaction carrying a `feeCurrency` field pays gas in an allowlisted ERC-20 — USDC, USD₮, or Mento stablecoins — via `debitGasFees`/`creditGasFees` at the protocol level, from any EOA. The catch is the signer must build a CIP-64 transaction: viem/ethers/web3.js app-side code can set `feeCurrency`; MetaMask drops the field and charges CELO; MiniPay/Valora handle it themselves. (Source: https://docs.celo.org/build-on-celo/fee-abstraction/overview, 22 Nov 2026)
  - **Adapter rule:** 6-decimal tokens (USDC, USD₮, USA₮) go through an adapter, and the **adapter address — not the token address — is the `feeCurrency` value**. USDC adapter: `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B`; USD₮ adapter: `0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72`. 18-decimal USDm/cUSD uses its own token address as `feeCurrency`. (Sources: https://docs.celo.org/build-on-celo/fee-abstraction/overview; https://x402.celo.org/skill.md, 22 Nov 2026)
  - Design consequence: an agent wallet funded only in stablecoins can do everything (register its ERC-8004 identity, send tagged transactions) with zero CELO, as long as our own code (viem) sets `feeCurrency`. And in the x402 flows the buyer needs no gas at all — the facilitator pays settlement gas (see §3).

---

## 7. Loops skill audit — `npx loopshouse add agents-open-for-business`

**The package.** npm package **`loopshouse`**, latest version **0.7.1** (dist-tag `latest`), MIT-licensed, single maintainer (`nickthegreek!`). It installs a single bundled binary: `bin: { "loops": "dist/loops.js" }` (~2 MB bundle, Node ≥ 18). Runtime dependencies: `incur`, `@supabase/supabase-js`, `picocolors`, `@clack/prompts` — i.e. a CLI framework, a Supabase client (Loops' backend), and terminal UI helpers. No install/postinstall scripts appear in the published metadata (build scripts run only via `prepublishOnly` on the publisher's side). (Source: https://registry.npmjs.org/loopshouse, read 22 Nov 2026; npmjs.com itself returned 403 to the fetcher, so the registry JSON was used.)

**What `add` does.** Per Loops House's own site: "Run one command — `npx loopshouse add` and your AI coding agent learns the hackathon… Cursor, Claude Code, Codex, VSCode, or anything that supports the open **.agents standard**." `npx loopshouse add <event-slug>` installs the event into the coding agent: it writes a per-event **skill file** into the project and relies on the `loops` CLI being installed (`npm install -g loopshouse`). (Source: https://www.loops.house/, 22 Nov 2026)

**What the installed skill contains** (verified from two public, real installs of sibling events found on GitHub — the `agents-open-for-business` skill itself is generated/served at install time and could not be inspected in advance; see flags below):
- Location/shape: `.agents/skills/loops-<event-slug>/SKILL.md` with frontmatter (`name: loops-<slug>`, `description`, `version`, `requires_bin: loops`).
- Content: the event's data (stage, deadlines, tracks/problems, rubrics), ready-to-run `loops` commands pre-filled with the event slug, and a workflow: (1) check auth with `loops auth status` first, (2) read event data + `loops project get` for submission state, (3) ideate with the built-in mentor (`loops hackathon ideate`) and ground sponsor facts via `loops knowledge query` (graph-RAG over sponsor docs), (4) create/update the project submission (`loops project create`), save artifacts, (5) self-evaluate with `loops evaluate` against each sponsor's judging criteria before the deadline.
- Auth: `loops auth login --provider google` / `--provider github` (browser OAuth) or email one-time code (`loops auth login --email …` + `loops auth verify --code …`). Conversations/sessions persist locally per event under `~/.loops/sessions/`.
- (Sources: https://github.com/moliagrawal/GoNoGo/blob/HEAD/.agents/skills/loops-rbu-ai-week/SKILL.md; https://github.com/Janhavi1214/The-Praise-Board/blob/HEAD/.agents/skills/loops-zero-to-one-tech-builder-series/SKILL.md, 22 Nov 2026)
- There is also an MCP mode: `npx -y loopshouse@0.7.1 --mcp` (stdio) or the hosted endpoint `https://www.loops.house/api/mcp` (streamable HTTP, requires sign-in/API key). (Sources: https://serverdex.io/server/io-github-germina-labs-loops; https://lookupd.com/servers/io.github.Germina-Labs/loops, 22 Nov 2026)

**Red flags / audit notes.**
- **Source repo not publicly auditable at its listed location.** The npm metadata's `repository` field carries no URL (only `directory: "skill"`); the MCP registry lists the repo as `github.com/Germina-Labs/loops-platform`, which returned **HTTP 404** on 22 Nov 2026 (private, moved, or renamed). So the CLI's code cannot be fully source-audited from public links today — the published npm bundle is the only artifact. **UNVERIFIED**: full source availability.
- **The skill is, by design, an instruction file for your agent.** The SKILL.md files direct the agent's behaviour (run auth checks, follow suggested next commands/CTAs, create submissions, evaluate). In the two sibling-event skills reviewed, the instructions are confined to the hackathon workflow and `loops …` commands — **no** requests to read unrelated local files, environment secrets, or credentials, and no exfiltration-style content were found. But the exact `agents-open-for-business` SKILL.md is fetched/generated at install time from Loops' servers, so its content **cannot be pre-audited** and could differ — **UNVERIFIED** for this event. Read the installed file before letting an agent act on it.
- **Credential handling is Loops' own.** The CLI holds a Loops account session (OAuth/email-code) and stores session state locally (`~/.loops/`); its backend is Supabase. It does not ask for wallet keys or other services' credentials in any material reviewed. The hosted MCP endpoint refuses unauthenticated calls (401/403 in registry checks).
- **Registry hygiene caveats:** the MCP registry entry is marked "Unclaimed · Unverified" (lookupd) and Serverdex found no licence for the MCP entry — though the npm package itself is MIT. Publisher is an individual maintainer account, not an organisation.
- **Verdict:** consistent with a small hackathon-platform CLI + agent skill; no malicious indicators found in the materials reviewed, but (a) source isn't publicly inspectable at the listed repo URL and (b) the per-event skill content is server-generated at install time. If we use it: install in the project sandbox only, read `.agents/skills/loops-agents-open-for-business/SKILL.md` in full before acting on it, and prefer it for submission management rather than granting it blanket trust. (This audit did **not** run the command.)

---

## Open questions (UNVERIFIED items the design depends on)

1. **Agent Vault × x402 (Track 2 blocker).** The track brief says an x402 payment can be made by "the Agent Vault agent wallet", but Self's own docs (via docs.celo.org) state Agent Vault has no wallet, no blockchain component and no x402 support. Confirm with the Self livestream (24 Nov) / sponsor docs whether some newer Agent Vault feature exists; until then, design assumes the x402 payment comes from our own wallet via `@x402/fetch`. — UNVERIFIED
2. **ERC-8004 `register()` gas cost** in CELO/stablecoin terms — no official figure found. Measure on Celo Sepolia during the build. — UNVERIFIED
3. **Exact Solidity signature/overloads of `register()`** on the Celo Identity Registry (e.g. `register(string agentURI)` vs metadata-array variants) — the Celo docs describe behaviour (`register()`, `setAgentURI`, `Registered` event) but the fetched pages did not include the ABI. Pull the ABI from the contracts repo (`abis/` in erc-8004/erc-8004-contracts) at build time. — UNVERIFIED
4. **The `agents-open-for-business` Loops SKILL.md content** — server-generated at install; audit the installed file before use (see §7). — UNVERIFIED
5. **Loops CLI source availability** — listed repo URL 404s; only the npm bundle is inspectable. — UNVERIFIED
6. **Whether one Self Agent ID registration also satisfies the event's ERC-8004 requirement**, or whether the reference registry (`0x8004A169…`) registration is also expected — the Celo docs note the two are separate deployments and an agent "can be registered in both". Cheap to do both; confirm via the event FAQ/Co-Pilot if time permits. — UNVERIFIED
7. **docs.celo.org tagging page content** — the page failed to load during research; §5 is sourced from the official celo-org/attribution-tags repo instead. Re-check the docs page at build time for any event-specific tagging guidance. — UNVERIFIED
