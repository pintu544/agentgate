/**
 * Client wiring for the buyer agent:
 * - viem account + public client on Celo mainnet (public Forno RPC),
 * - a wallet client extended with the ERC-8021 attribution tag
 *   (`withAttribution`) — every transaction this wallet sends directly
 *   (e.g. the ERC-8004 registration in T2.2) carries our issued code
 *   `celo_b4690008b08e`. x402 settlements are submitted by the facilitator
 *   and carry no tag; those are attributed via the registered PayTo
 *   address instead (see spec/research.md §5),
 * - the Self Agent ID signer (`SelfAgent`) for signed HTTP headers,
 * - the x402 payment client (`@x402/fetch` + `ExactEvmScheme`) with
 *   explicit client-side spend controls set via `setSpendControls`
 *   (a config object passed to the constructor would be silently ignored).
 *
 * Client types are inferred from the factory functions below rather than
 * named via viem's exported generics: the @x402 packages resolve viem's
 * CJS declarations while this package resolves the ESM ones, and the two
 * declaration copies of PublicClient/WalletClient are not mutually
 * assignable even though they are the same runtime objects.
 */
import { SelfAgent } from "@selfxyz/agent-sdk";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { ATTRIBUTION_TAG, CELO_NETWORK, USDC_CELO_MAINNET, type BuyerConfig } from "./config.js";

function makePublicClient(cfg: BuyerConfig) {
  return createPublicClient({ chain: celo, transport: http(cfg.rpcUrl) });
}

function makeWalletClient(cfg: BuyerConfig, account: Account) {
  return createWalletClient({ account, chain: celo, transport: http(cfg.rpcUrl) }).extend(
    withAttribution(ATTRIBUTION_TAG),
  );
}

export interface BuyerClients {
  account: Account;
  publicClient: ReturnType<typeof makePublicClient>;
  /** Wallet client whose direct transactions carry the attribution tag. */
  walletClient: ReturnType<typeof makeWalletClient>;
  selfAgent: SelfAgent;
  paymentClient: x402Client;
}

export function buildClients(cfg: BuyerConfig): BuyerClients {
  const account = privateKeyToAccount(cfg.privateKey);
  const publicClient = makePublicClient(cfg);
  const walletClient = makeWalletClient(cfg, account);
  const selfAgent = new SelfAgent({
    privateKey: cfg.privateKey,
    network: "mainnet",
    rpcUrl: cfg.rpcUrl,
  });
  // ClientEvmSigner over the viem account, composed directly:
  // signTypedData is all an EIP-3009 payment needs; readContract is wired
  // for completeness (extension enrichment).
  const signer: ClientEvmSigner = {
    address: account.address,
    signTypedData: (message) =>
      account.signTypedData(message as Parameters<typeof account.signTypedData>[0]),
    readContract: (args) =>
      publicClient.readContract(args as Parameters<typeof publicClient.readContract>[0]),
  };
  const paymentClient = new x402Client();
  paymentClient.register("eip155:*", new ExactEvmScheme(signer, { rpcUrl: cfg.rpcUrl }));
  paymentClient.setSpendControls({
    // Only Celo-mainnet USDC, capped per payment at the configured amount.
    allowedAssets: [
      { network: CELO_NETWORK, asset: USDC_CELO_MAINNET, maxAmountPerPayment: cfg.maxPerPaymentAtomic },
    ],
    // Hard ceiling for any recognised default asset: $1 per payment.
    maxAmountPerPayment: "$1",
  });
  return { account, publicClient, walletClient, selfAgent, paymentClient };
}
