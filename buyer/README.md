# AgentGate buyer agent

The buying side of AgentGate: a Node CLI that acts as the agent wallet. It
signs every request with its Self Agent ID headers, pays the seller over
x402 on Celo mainnet when asked, and writes a Markdown run report per
session.

## How a purchase flows

1. The CLI builds the request and signs it with `@selfxyz/agent-sdk`
   (`SelfAgent.signRequest`) — fresh headers per HTTP attempt, so the
   x402 payment retry is never mistaken for a replay by the seller's
   verifier.
2. `POST /api/snapshot` goes to the seller wrapped in
   `@x402/fetch`'s `wrapFetchWithPayment`. The seller's Self gate runs
   first: an unverified agent gets a 401 and no payment is ever created.
3. A verified agent without payment gets a 402; the x402 client creates
   the payment (USDC, EIP-3009, Celo mainnet) and retries. Settlement is
   submitted by the Celo facilitator; the settlement tx hash is read from
   the `PAYMENT-RESPONSE` header into the run report.

## Spend controls

Set explicitly via `client.setSpendControls(...)` (constructor config is
silently ignored by `@x402/core`): only Celo-mainnet USDC is allowed,
capped per payment at `BUYER_MAX_PER_PAYMENT_ATOMIC` (default `10000` =
0.01 USDC, exactly the snapshot price), plus a $1 hard ceiling for any
recognised default asset. A pricier demand is refused before signing.

## Attribution

The viem wallet client is extended with
`@celo/attribution-tags`' `withAttribution('celo_b4690008b08e')`, so every
transaction this wallet sends directly (e.g. the ERC-8004 registration)
carries the event's Schema 0 tag. x402 settlements are submitted by the
facilitator and carry no tag; they are attributed via the registered
PayTo address instead.

## Usage

```bash
npm install
npm run gen-key        # throwaway dev wallet -> buyer/.env (0600, gitignored)
npm start -- info      # address, Self Agent ID status, balances
npm start -- buy "Stripe"   # one purchase attempt + run report in reports/
```

Exit codes: 0 served · 1 error · 2 denied by the Self gate · 3 payment
failed (spend-control refusal, insufficient balance, …).

## Configuration (env only — never commit a key)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BUYER_PRIVATE_KEY` | — (required) | Agent wallet key, `0x` + 64 hex. |
| `SELLER_URL` | `https://agentgate-seller.vercel.app` | Seller base URL. |
| `CELO_RPC_URL` | `https://forno.celo.org` | Celo mainnet RPC. The design called for Chainstack; no Chainstack key exists in Doppler, so the public RPC is used (TASKS T2.1). |
| `BUYER_MAX_PER_PAYMENT_ATOMIC` | `10000` | Per-payment cap in USDC atomic units. |
| `BUYER_REPORTS_DIR` | `./reports` | Where run reports and snapshots are written. |

The throwaway key from `gen-key` is for development only — the wallet is
unregistered (the seller correctly denies it) and unfunded. The real
agent wallet key is supplied by the project owner via env/Doppler.
