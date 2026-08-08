// Non-interactive Preprod deployment + smoke test.
//
//   npm run deploy-preprod          (from quorum-cli/)
//
// Deploys a fresh Quorum poll, opens a question, casts one vote, then attempts
// a second vote from the same identity to show the circuit rejecting it. Prints
// the contract address and the final ledger state; the transcript is the
// submission artifact captured in docs/deploy-output.txt.
//
// This exists alongside the interactive CLI because a deployment record should
// be reproducible by running one command, not by replaying a menu session.

import { WebSocket } from 'ws';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as Rx from 'rxjs';

import { QuorumAPI, type QuorumDerivedState, type QuorumProviders, type PrivateStateId } from '../../api/src/index';
import { type QuorumPrivateState } from '../../contract/src/witnesses.js';
import { PreprodRemoteConfig, PreviewRemoteConfig, type Config } from './config.js';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { getQuorumLedgerState } from './index.js';

// @ts-expect-error: needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

type QuorumCircuits = 'open' | 'vote' | 'close' | 'reset';

const QUESTION = 'Should we move to a four-day week?';

const SEED_FILE = path.resolve(process.cwd(), '..', '.wallet-seed.local');

const readSeed = (): string => {
  if (!existsSync(SEED_FILE)) {
    throw new Error(`No wallet seed at ${SEED_FILE}. Run \`npm run new-wallet\` first, then fund the address.`);
  }
  const seed = readFileSync(SEED_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (seed === undefined) {
    throw new Error(`${SEED_FILE} contains no seed line.`);
  }
  return seed;
};

const say = (message: string): void => {
  console.log(message);
};

/**
 * Which network to deploy to. Preview and Preprod are both accepted testnets
 * for submission, so this stays a flag rather than an edit.
 *
 *   npm run deploy-preview     npm run deploy-preprod
 */
const selectConfig = (): Config => {
  const requested = (process.argv[2] ?? process.env.QUORUM_NETWORK ?? 'preview').toLowerCase();
  switch (requested) {
    case 'preprod':
      return new PreprodRemoteConfig();
    case 'preview':
      return new PreviewRemoteConfig();
    default:
      throw new Error(`Unknown network '${requested}'. Use 'preview' or 'preprod'.`);
  }
};

const main = async (): Promise<void> => {
  const config = selectConfig();
  const logger = await createLogger(config.logDir);
  const testEnv = config.getEnvironment(logger);
  const seed = readSeed();

  let walletProvider: MidnightWalletProvider | undefined;
  try {
    say('== Starting environment (this pulls up a proof server container) ==');
    const env = await testEnv.start();
    say(`   network:      ${env.networkId}`);
    say(`   indexer:      ${env.indexer}`);
    say(`   node:         ${env.node}`);
    say(`   proof server: ${env.proofServer}`);

    say('\n== Wallet ==');
    walletProvider = await MidnightWalletProvider.build(logger, env, seed);
    const walletFacade: WalletFacade = walletProvider.wallet;
    await walletProvider.start();

    const unshieldedState = await waitForUnshieldedFunds(
      logger,
      walletFacade,
      env,
      unshieldedToken(),
      config.fundFromFaucet,
    );
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined || nightBalance === 0n) {
      throw new Error('Wallet holds no tNIGHT — fund the address and re-run.');
    }
    say(`   NIGHT balance: ${nightBalance}`);

    if (config.generateDust) {
      say('\n== Registering NIGHT for dust generation (pays the fees) ==');
      const txId = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (txId) {
        say(`   dust registration tx: ${txId}`);
        await syncWallet(logger, walletFacade);
      }
    }

    const zkConfigProvider = new NodeZkConfigProvider<QuorumCircuits>(config.zkConfigPath);
    const providers: QuorumProviders = {
      privateStateProvider: levelPrivateStateProvider<PrivateStateId, QuorumPrivateState>({
        privateStateStoreName: config.privateStateStoreName,
        signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => 'Quorum-Test-2026!',
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(env.proofServer, zkConfigProvider),
      walletProvider,
      midnightProvider: walletProvider,
    };

    say('\n== Deploying the Quorum contract ==');
    const api = await QuorumAPI.deploy(providers, logger);
    say(`   CONTRACT ADDRESS: ${api.deployedContractAddress}`);

    let latest: QuorumDerivedState | undefined;
    const subscription = api.state$.subscribe({ next: (s) => (latest = s) });

    try {
      say(`\n== open("${QUESTION}") ==`);
      await api.open(QUESTION);
      say('   poll opened');

      say('\n== vote(yes) ==');
      await api.vote(true);
      say('   vote accepted');

      say('\n== vote(yes) again, from the same identity ==');
      try {
        await api.vote(true);
        say('   !! UNEXPECTED: the second vote was accepted');
        process.exitCode = 1;
      } catch (e) {
        // The assertion fires during local proof generation, before a
        // transaction is built — a rejected double vote costs nothing and
        // reveals nothing to the network.
        say(`   rejected locally, no transaction submitted: ${e instanceof Error ? e.message : String(e)}`);
      }

      // The observable is driven by indexer pushes; give it a moment to catch
      // up with the vote before snapshotting.
      await Rx.firstValueFrom(Rx.timer(3_000));

      say('\n== Ledger state (what any observer can see) ==');
      const ledgerState = await getQuorumLedgerState(providers, api.deployedContractAddress);
      if (ledgerState === null) {
        say('   contract not found via the indexer');
      } else {
        say(`   question:   ${ledgerState.question.is_some ? ledgerState.question.value : 'none'}`);
        say(`   yes votes:  ${ledgerState.yesVotes}`);
        say(`   no votes:   ${ledgerState.noVotes}`);
        say(`   round:      ${ledgerState.round}`);
        say(`   nullifiers: ${ledgerState.nullifiers.size()}`);
        for (const nullifier of ledgerState.nullifiers) {
          say(`     - ${toHex(nullifier)}`);
        }
        say('   (the set above holds hashes, not identities — no entry names a voter)');
      }

      if (latest) {
        say('\n== Derived state (only this DApp instance can compute it) ==');
        say(`   my nullifier this round: ${latest.myNullifier}`);
        say(`   have I voted?            ${latest.hasVoted ? 'yes' : 'no'}`);
        say(`   am I the organizer?      ${latest.isOrganizer ? 'yes' : 'no'}`);
        say('   these three need the secret key; an observer with the same ledger cannot derive them');
      }
    } finally {
      subscription.unsubscribe();
    }

    say(`\n== Done ==`);
    say(`Deployed Quorum contract address: ${api.deployedContractAddress}`);
  } finally {
    if (walletProvider) {
      await walletProvider.stop();
    }
    await testEnv.shutdown();
  }
};

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: unknown) => {
    console.error('\nDeployment failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  },
);
