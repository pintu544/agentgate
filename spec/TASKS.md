# AgentGate — TASKS

Slices are end-to-end and independently reviewable. Pintu-only steps are marked 👤. Deadline: submission filed before Mon 7 Dec 2026, 14:30 IST. Repo + Submit-lane shell must exist before the AskBots review, Tue 24 Nov 19:30 IST.

## Slice 0 — Repo and entry shell (do first, right after approval)
- [x] T0.1 Create public GitHub repo `agentgate` under pintu544 with description, live-URL placeholder and 3–7 topics; commit the spec pack. Done 22 Nov: https://github.com/pintu544/agentgate verified via `gh repo view` (public, description, 6 topics).
- [x] T0.2 Fill Loops House Submit lane Step 1 (logo, name, tagline, description from SPEC). Done 22 Nov: all four fields saved and verified retained after a Back/Next round-trip (tagline 188/250). Note: the Preview lane only shows the project once the whole submission is finished — Step 1 alone does not make it previewable.

## Slice 1 — Seller service: the gate (Track 3 core)
- [x] T1.1 Scaffold the Express + TypeScript seller with the x402 v2 packages (`@x402/express`, `@x402/core`, `@x402/evm`) and `@selfxyz/agent-sdk`; health endpoint live. Done means: service runs locally and on Vercel with a 200 health check.
- [x] T1.2 Self Agent ID verification middleware, deny-by-default: raw body preserved, verifier errors/timeouts resolve to a 401 deny with the verifier's error string. Done means: an unsigned request and a request from an unregistered address both return 401 with distinct, correct error strings, and nothing is served.
- [x] T1.3 x402 payment gate on `POST /api/snapshot` via the Celo facilitator, explicit USDC price object. Done means: a verified-shaped request without payment returns 402 with valid payment requirements. (Full verified+paid path is proven in Slice 2.)
- [ ] 👤 T1.4 Pintu creates the x402 facilitator API key at x402.celo.org, signing in with GitHub so the up-to-100 free mainnet settlement credits are granted (skipping forfeits them permanently). Done means: the key exists in Doppler as the seller's facilitator credential.
- [x] T1.5 Snapshot generation via Exa + append-only call log + public `GET /log` page. Done means: a served response contains summary, key facts and sources; every test attempt above appears in the log with its verification result.
- [ ] T1.6 Adversarial QA pass on Slice 1 (fresh agent): replayed signatures, tampered bodies, oversized topics, verifier-timeout behaviour. Done means: no critical findings open.

## Slice 2 — Buyer agent and identity (Track 3 end-to-end)
- [ ] T2.1 Agent wallet wiring: Chainstack Celo RPC, viem client extended with `@celo/attribution-tags`; wallet key only in env/Doppler. Done means: a tagged test read/write round-trip is visible on Celoscan with the tag suffix present. 👤 Pintu funds the wallet with demo-scale CELO + USDC.
- [ ] T2.2 ERC-8004 registration: publish the registration JSON, call `register(agentURI)` on the Celo mainnet registry from the agent wallet (tagged), read the agent ID from the `Registered` event, backfill the file. Done means: the agent resolves on 8004scan with the correct owner and URI.
- [ ] T2.3 Add the agent wallet to the Loops House entry (saves the ERC-8004 identity + tag against the entry). Done means: the playground shows the wallet against Pintu's entry.
- [ ] 👤 T2.4 Pintu registers the agent on Self: scans the registration QR in the Self app with his passport, minting the agent's Self Agent ID to the agent wallet. Done means: the verifier accepts the agent's signed headers.
- [ ] T2.5 Buyer CLI: signs Self headers, pays via `@x402/fetch` with explicit spend controls, saves the snapshot and writes the run report. Done means: one full mainnet purchase completes — 200 snapshot, settlement tx hash in the report, log entry on the seller marked served.
- [ ] T2.6 Deny-path proof: a second, unregistered wallet calls the service and is denied. Done means: 401 logged, no payment taken, both runs captured for the demo.

## Slice 3 — Agent Vault leg and submission (Track 2 + filing)
- [ ] T3.1 Spike: complete one Agent Vault sign-in end-to-end via the hosted MCP and pick the demo website from what provably works (fallback: Agent Vault's demo environment). Done means: one real sign-in completed with the agent never exposed to the credential. 👤 Pintu authorises the Agent Vault OAuth and enters the vaulted credential/card himself.
- [ ] T3.2 Configure the Agent Vault spending limit for the demo and capture the breach: a fill above the limit is refused with `limit_reached`. Done means: the refusal is recorded with the limit value visible.
- [ ] T3.3 README (named user, real job, how another agent can buy, payment-route note from DESIGN), demo video of the three GRILL beats with Celoscan links, and the required X post drafted for 👤 Pintu to post (tags @selfxyz and @celo).
- [ ] T3.4 File the full submission in the Loops House Submit lane. Step 2 fields (captured live 22 Nov): screenshots (1–4, ≥1 required), repository URL, live app URL, video URL, agent wallet address, team contacts (name, email, Telegram, X handle), region, payout wallet on Celo, ERC-8004 agent ID, Self Agent ID (mainnet agentId), attribution tag, x402 PayTo address, named user statement, optional buy tx hashes, per-track detail blocks — Agent Vault block (x402 tx hash, websites used through Agent Vault, spending rule set) and Self Agent ID block (x402 tx hash + a link to the file and line where the Self Agent ID check happens), public X post link, founder/project X handles, follow @Celo + @CeloDevs confirmation. Done means: Preview lane shows the complete project before 7 Dec 14:30 IST, with margin.
- [ ] T3.5 Answer any AskBots review issues on the repo (rounds: 24 Nov and 4 Dec) and do a final adversarial QA pass over the whole build. Done means: no critical findings open; all demo claims match onchain evidence.
