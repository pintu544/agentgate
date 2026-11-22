# AgentGate — GRILL

Build: one project entering Track 3 (Self Agent ID) + Track 2 (Agent Vault) of Agents Open for Business (Celo, Loops House). Deadline: Mon 7 Dec 2026, 14:30 IST. Grill locked 22 Nov 2026; API-level answers depend on spec/research.md (sponsor docs, verified 22 Nov).

**Q1. What is the one demo that proves it works?**
A single recorded run with three beats: (1) a Self-Agent-ID-verified buyer agent pays via x402 and receives its research snapshot; (2) an unverified agent calls the same endpoint and is denied, with no payment taken and no work done; (3) the buyer agent attempts a website fill through Agent Vault that breaches its configured Agent Vault spending limit and is refused (limit_reached), on camera. Celoscan links for the identity registration and the payments sit under the video. (Beat 3 revised 22 Nov after research.md §2: Agent Vault enforces limits on vaulted card/credential fills; it does not make x402 payments — the x402 payment comes from the agent's own wallet.)

**Q2. What does the service actually sell?**
A one-page prospect research snapshot — what a company does, key facts, and sources — generated per request from live web search (Exa, already keyed in Doppler). It is a real input to Pintu's freelance outreach work, not a toy payload. Price: a small fixed amount per call in a Celo stablecoin, settled via x402.

**Q3. Who is the named user?**
Pintu's own freelance practice (Web Krypton Labs): the buyer agent procures prospect research before client outreach. The service is open to any Agent-ID-verified agent; the named user and the real job are stated honestly in the submission.

**Q4. Which wallets, and who funds what?**
One agent wallet owned by Pintu (his existing Celo wallet if it is an EOA he controls, otherwise a fresh one created for this agent) — it is registered on ERC-8004 and added to the Loops House entry before the first tagged transaction. The seller's PayTo address is a wallet Pintu owns. Funding is demo-scale only (a few dollars of Celo stablecoin plus CELO for gas) and is Pintu's step — Muse never holds or moves his funds beyond what the agent code he approves sends.

**Q5. Which website does the buyer agent sign in to through Agent Vault?**
Per research.md §2, Agent Vault sign-in works by the agent filling forms with tokenised vault values inside Agent Vault's proxy (via its hosted MCP), never seeing the real credential. The target site is chosen by a short spike at the start of Slice 3 from the sites this flow provably completes; the fallback is Agent Vault's own demo environment if one is offered. A sign-in flow alone satisfies Track 2's website requirement; a card checkout is explicitly optional and out of scope.

**Q6. What is the stack?**
TypeScript throughout. Seller: a small Express API service (revised 22 Nov per research.md §3 — the x402 v2 seller packages support Express/Hono only) exposing the paid endpoint behind an Agent ID gate and x402. Buyer: a Node CLI agent using viem against Celo mainnet via Chainstack RPC. No custom smart contracts — ERC-8004 registry, the x402 facilitator and Agent Vault are existing sponsor infrastructure.

**Q7. Where does it run?**
Seller service on Vercel (public URL for judges). Buyer agent runs on demand from the CLI — the demo is a recording of a real mainnet run, not a simulation. Code in a public GitHub repo under pintu544, created during the event window.

**Q8. What are the boundary and failure behaviours?**
Unverified caller → clear deny response, no payment accepted, no work performed, attempt logged. Verified caller without payment → payment required (402), nothing served. Agent at its Agent Vault cap → the vault blocks the spend and the agent reports the stop instead of retrying. Insufficient wallet balance → clean error naming the missing balance. Every transaction the agent itself sends carries the attribution tag celo_b4690008b08e; x402 settlements cannot carry tags, so the PayTo address is registered with the entry instead (per the event rules).

**Q9. What is explicitly out of scope?**
Tracks 1 (Textile FX) and 4 (Altana) — stretch only after this build is submitted. No own token, no custom contracts, no multi-tenant SaaS, no credential storage anywhere except inside Agent Vault by design, no mainnet spend beyond demo-scale amounts, no card checkout.

**Q10. What counts as completion evidence?**
Live seller URL returning the deny/allow behaviour; public repo; Celoscan proof of the ERC-8004 registration and at least one tagged agent transaction plus settled x402 payments; a demo video showing all three Q1 beats; an X post with the demo clip and repo link tagging @selfxyz and @celo (required by both tracks — Pintu posts or approves it); submission filed in the Loops House Submit lane before 7 Dec 14:30 IST.
