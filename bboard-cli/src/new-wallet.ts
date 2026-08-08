// Generates a fresh Midnight wallet and prints its unshielded address.
//
// Run this before the contract is built: it needs only the wallet SDK, not the
// compiled circuits, so funding can happen in parallel with the rest of the work.
//
//   npm run new-wallet          (from bboard-cli/)
//
// The master seed is written to .wallet-seed.local at the project root and is
// gitignored. It is a private key: anyone holding it controls the wallet, so it
// must never be committed, pasted into chat, or included in a screenshot.

import { LedgerParameters } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
} from '@midnight-ntwrk/testkit-js';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';

const NETWORK = 'preprod';

// Mirrors PreprodTestEnvironment.getEnvironmentConfiguration() in ./config.ts.
// proofServer is a placeholder: deriving an address needs no proving, and the
// wallet is never started here.
const environment: EnvironmentConfiguration = {
  walletNetworkId: NETWORK,
  networkId: NETWORK,
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  nodeWS: 'wss://rpc.preprod.midnight.network',
  faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  proofServer: 'http://127.0.0.1:6300',
};

const SEED_PATH = path.resolve(process.cwd(), '..', '.wallet-seed.local');

// Comment lines are metadata; the single non-comment line is the master seed.
const readExistingSeed = (): string | undefined => {
  if (!existsSync(SEED_PATH)) return undefined;
  const seed = readFileSync(SEED_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  return seed;
};

const main = async (): Promise<void> => {
  setNetworkId(NETWORK);

  // Reuse an existing seed rather than replacing it: once the address has been
  // funded, generating a fresh wallet would orphan the tNIGHT.
  const existingSeed = readExistingSeed();

  // Constructed inside main() rather than at module scope, matching
  // midnight-wallet-provider.ts:99.
  const dustOptions: DustWalletOptions = {
    ledgerParams: LedgerParameters.initialParameters(),
    additionalFeeOverhead: 1_000n,
    feeBlocksMargin: 5,
  };

  const builder = FluentWalletBuilder.forEnvironment(environment).withDustOptions(dustOptions);
  const { wallet, seeds } = (await (existingSeed
    ? builder.withSeed(existingSeed)
    : builder.withRandomSeed()
  ).buildWithoutStarting()) as unknown as {
    wallet: WalletFacade;
    seeds: { masterSeed: string };
  };

  // The unshielded address is the one the faucet funds and the one
  // waitForUnshieldedFunds() watches — see wallet-utils.ts:107.
  const unshieldedState = await Rx.firstValueFrom(wallet.unshielded.state);
  const address = UnshieldedAddress.codec.encode(getNetworkId(), unshieldedState.address).toString();

  const seedPath = SEED_PATH;
  writeFileSync(
    seedPath,
    [
      '# Midnight wallet seed — PRIVATE KEY. Never commit or share.',
      `# network: ${NETWORK}`,
      `# address: ${address}`,
      '',
      seeds.masterSeed,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  try {
    chmodSync(seedPath, 0o600);
  } catch {
    // Best effort: on some filesystems (e.g. DrvFs) mode changes are ignored.
  }

  console.log('');
  console.log(existingSeed ? '  Reused the existing seed.' : '  Generated a new wallet.');
  console.log('  Network:  ' + NETWORK);
  console.log('  Address:  ' + address);
  console.log('');
  console.log('  Seed saved to: ' + seedPath + '  (gitignored, mode 600)');
  console.log('  Fund the address above with tNIGHT, then deployment can proceed.');
  console.log('');
};

// The wallet was built without starting, but the SDK still leaves handles open;
// exit explicitly rather than waiting for the event loop to drain.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('Failed to generate wallet:', error);
    process.exit(1);
  },
);
