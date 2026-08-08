// Reports the funded wallet's NIGHT and DUST balance, then exits.
//
//   npm run balance          (from quorum-cli/)
//
// Deliberately short-lived and independent of the deploy run: it answers "did
// the tNIGHT actually land?" without touching or waiting on anything else.

import { WebSocket } from 'ws';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { type DustWalletOptions, FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import { LedgerParameters } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';

// @ts-expect-error: needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// Network is a flag so this works against whichever testnet the deploy targets:
//   npm run balance -- preview      npm run balance -- preprod
const requestedNetwork = (process.argv[2] ?? process.env.QUORUM_NETWORK ?? 'preview').toLowerCase();
if (requestedNetwork !== 'preview' && requestedNetwork !== 'preprod') {
  throw new Error(`Unknown network '${requestedNetwork}'. Use 'preview' or 'preprod'.`);
}
const NETWORK: 'preview' | 'preprod' = requestedNetwork;
const TIMEOUT_MS = 90_000;

const environment = {
  walletNetworkId: NETWORK,
  networkId: NETWORK,
  indexer: `https://indexer.${NETWORK}.midnight.network/api/v4/graphql`,
  indexerWS: `wss://indexer.${NETWORK}.midnight.network/api/v4/graphql/ws`,
  node: `https://rpc.${NETWORK}.midnight.network`,
  nodeWS: `wss://rpc.${NETWORK}.midnight.network`,
  faucet: `https://midnight-tmnight-${NETWORK}.nethermind.dev/`,
  // Only used for proving; a balance read never proves anything, but the
  // builder still requires the field.
  proofServer: process.env.QUORUM_PROOF_SERVER ?? 'http://127.0.0.1:6300',
};

const SEED_FILE = path.resolve(process.cwd(), '..', '.wallet-seed.local');

const readSeed = (): string => {
  if (!existsSync(SEED_FILE)) throw new Error(`No seed at ${SEED_FILE}`);
  const seed = readFileSync(SEED_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  if (!seed) throw new Error(`${SEED_FILE} has no seed line`);
  return seed;
};

const main = async (): Promise<void> => {
  setNetworkId(NETWORK);
  const seed = readSeed();

  const dustOptions: DustWalletOptions = {
    ledgerParams: LedgerParameters.initialParameters(),
    additionalFeeOverhead: 1_000n,
    feeBlocksMargin: 5,
  };

  // build() returns the started facade itself — buildWithoutStarting() is the
  // one that returns { wallet, seeds, keystore }. We want it started so it syncs.
  const wallet: WalletFacade = await FluentWalletBuilder.forEnvironment(environment)
    .withDustOptions(dustOptions)
    .withSeed(seed)
    .build();

  const token = unshieldedToken();
  const initial = await Rx.firstValueFrom(wallet.unshielded.state);
  const address = UnshieldedAddress.codec.encode(getNetworkId(), initial.address).toString();

  console.log('');
  console.log(`  address: ${address}`);
  console.log(`  NIGHT at first read: ${initial.balances[token.raw] ?? 0n}`);
  console.log('');
  console.log(`  syncing (up to ${TIMEOUT_MS / 1000}s) ...`);

  // Watch for a positive balance rather than trusting the first emission —
  // the wallet reports 0 until it has scanned far enough forward.
  const funded = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((s) => {
        const bal = s.unshielded.balances[token.raw] ?? 0n;
        const dust = s.dust.balance(new Date());
        process.stdout.write(`\r  NIGHT=${bal}  DUST=${dust}   `);
      }),
      Rx.filter((s) => (s.unshielded.balances[token.raw] ?? 0n) > 0n),
      Rx.timeout({ first: TIMEOUT_MS, with: () => Rx.of(null) }),
    ),
  );

  console.log('');
  console.log('');
  if (funded === null) {
    console.log('  RESULT: no NIGHT found after syncing. The wallet is still empty.');
    process.exitCode = 2;
  } else {
    const bal = funded.unshielded.balances[token.raw] ?? 0n;
    const utxos = funded.unshielded.availableCoins.length;
    console.log(`  RESULT: FUNDED — ${bal} NIGHT across ${utxos} UTXO(s).`);
    console.log(`  DUST: ${funded.dust.balance(new Date())}`);
  }
  console.log('');
};

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    console.error('\nBalance check failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
