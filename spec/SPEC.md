# AgentGate — SPEC

**Problem.** AI agents are starting to buy services from each other, but a seller has no reliable way to know whether the agent calling it is backed by a verified human, and a buyer has no safe way to let an agent spend without handing it raw credentials and an open wallet. AgentGate is a working answer on Celo mainnet: a paid research service that only serves Self-Agent-ID-verified agents, bought by an agent that signs in and pays through Agent Vault under a hard spending cap.

**Users**
- The seller (Pintu / Web Krypton Labs): offers prospect research snapshots for sale to agents.
- The buyer agent: procures snapshots for the named user's freelance outreach, inside a budget.
- Judges and other builders: call the service with verified and unverified agents to see the gate work.

**Functional requirements**
1. The seller service SHALL expose one paid endpoint that returns a prospect research snapshot (company summary, key facts, sources) for a requested company or topic.
2. The service SHALL verify the calling agent's Self Agent ID before any paid work, and SHALL reject unverified callers with a clear deny response, taking no payment and performing no work.
3. The service SHALL require payment via x402 through Celo's native facilitator before serving a verified caller, and SHALL serve only after settlement.
4. The service SHALL log every call attempt — verified or not, paid or not — with the verification result visible in the log.
5. The buyer agent SHALL hold an ERC-8004 identity registered from its own wallet on Celo mainnet, before its first transaction.
6. Every transaction the buyer agent sends SHALL carry the attribution tag celo_b4690008b08e; the seller's PayTo address SHALL be registered with the hackathon entry (x402 settlements cannot carry tags).
7. The buyer agent SHALL sign in to a regular website through Agent Vault as part of its procurement flow, without the agent ever seeing the password or any vaulted value.
8. The buyer agent SHALL pay for snapshots via x402 from its own wallet, with client-side spend controls set below the demo budget; separately, a spending limit SHALL be configured in Agent Vault and the demo SHALL show Agent Vault refusing a fill that breaches it (research.md §2: Agent Vault's own docs describe no x402 or onchain payment support, so the x402 payment is made from the agent's wallet, not the vault — the event text's parenthetical on this point is contradicted by the sponsor's docs and is treated as UNVERIFIED).
9. The buyer agent SHALL produce a readable run report for each session: what it bought, what it paid, transaction hashes, and any deny or cap events.
10. The project SHALL be a public GitHub repository, written during the event window, with a README stating the named user, the real job, and how to reproduce the demo.

**Non-functional**
- All settlement on Celo mainnet (chain ID 42220); no testnet activity is presented as real use.
- Demo-scale money only: per-call price and cap set so the full demo costs a few dollars at most.
- No credentials in code, repo, or logs; wallet keys live in environment/Doppler only, never committed.
- The deny path must be safe by default: any verification error or timeout resolves to deny, never to serve.

**Out of scope**
Textile FX (Track 1) and Altana (Track 4) integrations; custom smart contracts; card checkout on retail websites; multi-user accounts or a hosted buyer-agent SaaS; spend beyond demo scale; storing any password or card data outside Agent Vault.

**Judging map (Tracks 3 + 2, both: integration 30 / innovation 30 / real use 25 / ambition 15)**
- Integration quality → FR2 + FR3 (Agent ID gate before paid work, both allow and deny shown) and FR7 + FR8 (Agent Vault sign-in and capped x402 payment).
- Innovation → the two-sided pairing itself: one flow where the seller trusts only verified agents and the buyer can only spend inside a vault cap.
- Real use → FR1 + FR9: a named user (Web Krypton Labs freelance outreach), real mainnet x402 calls, a run report with hashes.
- Ambition → the service stays live and open to any verified agent after the event; README documents how another agent can buy.
