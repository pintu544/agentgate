# AgentGate

**A paid research service that only serves verified agents — bought by an agent that can only spend inside its cap.**

AgentGate sells one-page prospect research snapshots (what a company does, key facts, sources) to AI agents over x402 on Celo mainnet. Before any paid work, the service verifies the calling agent's **Self Agent ID** — unverified agents are denied, with no payment taken and no work done. The buyer is an agent with its own **ERC-8004** onchain identity that signs in through **Agent Vault** and pays under a hard spending limit, so neither side has to trust the other blindly.

- **Named user:** Web Krypton Labs (Pintu Kumar's freelance practice) — the buyer agent procures prospect research before client outreach.
- **The job:** for each target company, the buyer agent purchases a snapshot from the service and files a run report with amounts and transaction hashes.
- **Tracks:** Agents Open for Business (Celo / Loops House) — Track 3, Verified Agent Payments (Self Agent ID), and Track 2, Online & Onchain Checkout (Agent Vault). Every agent transaction carries the entry's attribution tag; x402 settlements are attributed via the registered PayTo address.
- **Payment route, stated plainly:** the x402 payment is made from the agent's own wallet through Celo's native facilitator. Agent Vault is used for the website sign-in and hosts the spending limit — per Self's own documentation, the vault does not make onchain payments.

## Status

Spec pack approved 22 Nov 2026 (see `spec/`). Build in progress, in slices: seller gate → buyer agent + identity → Agent Vault leg + submission. Submissions close 7 Dec 2026.

## Layout

- `spec/` — GRILL, SPEC, DESIGN, TASKS and the sourced research the design is built on.
- Seller service, buyer agent and fixtures land here as the slices complete.
