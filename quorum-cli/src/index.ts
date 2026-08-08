/*
 * Main driver for the Quorum CLI.
 *
 * The entry point is `run`, at the end of the file. The launchers
 * (preprod.ts, preview.ts, standalone.ts) call it with the configuration that
 * pins the network addresses this file depends on.
 */

import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import {
  QuorumAPI,
  type QuorumDerivedState,
  quorumPrivateStateKey,
  type QuorumProviders,
  type DeployedQuorumContract,
  type PrivateStateId,
  pollStateLabel,
} from '../../api/src/index';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ledger, type Ledger } from '../../contract/src/managed/quorum/contract/index.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config, StandaloneConfig } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { QuorumPrivateState } from '../../contract/src/witnesses.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

/** The circuits that require proving, and therefore ZK keys. */
type QuorumCircuits = 'open' | 'vote' | 'close' | 'reset';

/**
 * Queries the current ledger state of a specific Quorum contract. The `Ledger`
 * type is the one the Compact compiler generated for this contract, not a
 * generic ledger object.
 */
export const getQuorumLedgerState = async (
  providers: QuorumProviders,
  contractAddress: ContractAddress,
): Promise<Ledger | null> => {
  assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  return contractState != null ? ledger(contractState.data) : null;
};

const DEPLOY_OR_JOIN_QUESTION = `
You can do one of the following:
  1. Deploy a new Quorum poll contract
  2. Join an existing Quorum poll contract
  3. Exit
Which would you like to do? `;

const deployOrJoin = async (providers: QuorumProviders, rli: Interface, logger: Logger): Promise<QuorumAPI | null> => {
  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1': {
        const api = await QuorumAPI.deploy(providers, logger);
        logger.info(`Deployed contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '2': {
        const address = await rli.question('What is the contract address (in hex)? ');
        const api = await QuorumAPI.join(providers, address, logger);
        logger.info(`Joined contract at address: ${api.deployedContractAddress}`);
        return api;
      }
      case '3':
        logger.info('Exiting...');
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

/**
 * Shows the ledger state — everything the chain knows, and everything any
 * observer can see. Note what is absent: no voter identities, and no link
 * between any nullifier and either tally.
 */
const displayLedgerState = async (
  providers: QuorumProviders,
  deployedQuorumContract: DeployedQuorumContract,
  logger: Logger,
): Promise<void> => {
  const contractAddress = deployedQuorumContract.deployTxData.public.contractAddress;
  const ledgerState = await getQuorumLedgerState(providers, contractAddress);
  if (ledgerState === null) {
    logger.info(`There is no Quorum contract deployed at ${contractAddress}`);
    return;
  }

  logger.info(`Poll state:  '${pollStateLabel(ledgerState.state)}'`);
  logger.info(`Question:    '${ledgerState.question.is_some ? ledgerState.question.value : 'none'}'`);
  logger.info(`Yes votes:   ${ledgerState.yesVotes}`);
  logger.info(`No votes:    ${ledgerState.noVotes}`);
  logger.info(`Round:       ${ledgerState.round}`);
  logger.info(`Organizer:   '${toHex(ledgerState.organizer)}'`);
  logger.info(`Voters so far: ${ledgerState.nullifiers.size()} (nullifiers, not identities)`);
  for (const nullifier of ledgerState.nullifiers) {
    logger.info(`  - ${toHex(nullifier)}`);
  }
};

/**
 * Shows the private state: the secret key that never leaves this process.
 */
const displayPrivateState = async (providers: QuorumProviders, logger: Logger): Promise<void> => {
  const privateState = await providers.privateStateProvider.get(quorumPrivateStateKey);
  if (privateState === null) {
    logger.info(`There is no existing Quorum private state`);
  } else {
    logger.info(`Current secret key is: ${toHex(privateState.secretKey)}`);
  }
};

/**
 * Shows the derived state — the ledger combined with the local secret key.
 *
 * The last three lines are the interesting ones: they are questions only the
 * key holder can answer. An observer with the same ledger data cannot compute
 * `hasVoted`, because doing so requires the secret key.
 */
const displayDerivedState = (state: QuorumDerivedState | undefined, logger: Logger) => {
  if (state === undefined) {
    logger.info(`No Quorum state currently available`);
    return;
  }

  logger.info(`Poll state:  '${pollStateLabel(state.state)}'`);
  logger.info(`Question:    '${state.question ?? 'none'}'`);
  logger.info(`Tally:       ${state.yesVotes} yes / ${state.noVotes} no`);
  logger.info(`Round:       ${state.round}`);
  logger.info(`Voters so far: ${state.nullifierCount}`);
  logger.info(`Your nullifier this round: ${state.myNullifier}`);
  logger.info(`Have you voted? ${state.hasVoted ? 'yes' : 'no'}`);
  logger.info(`Are you the organizer? ${state.isOrganizer ? 'yes' : 'no'}`);
};

const MAIN_LOOP_QUESTION = `
You can do one of the following:
  1. Open a new poll
  2. Vote
  3. Close the poll (organizer only)
  4. Reset the poll for a new round (organizer only)
  5. Display the current ledger state (known by everyone)
  6. Display the current private state (known only to this DApp instance)
  7. Display the current derived state (known only to this DApp instance)
  8. Exit
Which would you like to do? `;

const mainLoop = async (providers: QuorumProviders, rli: Interface, logger: Logger): Promise<void> => {
  const quorumApi = await deployOrJoin(providers, rli, logger);
  if (quorumApi === null) {
    return;
  }
  let currentState: QuorumDerivedState | undefined;
  const subscription = quorumApi.state$.subscribe({
    next: (state: QuorumDerivedState) => (currentState = state),
  });
  try {
    while (true) {
      const choice = await rli.question(MAIN_LOOP_QUESTION);
      try {
        switch (choice) {
          case '1': {
            const question = await rli.question(`What question do you want to ask? `);
            await quorumApi.open(question);
            break;
          }
          case '2': {
            const answer = (await rli.question(`Vote yes or no? `)).trim().toLowerCase();
            if (!['yes', 'y', 'no', 'n'].includes(answer)) {
              logger.error(`Please answer 'yes' or 'no'. Got: ${answer}`);
              break;
            }
            await quorumApi.vote(answer.startsWith('y'));
            break;
          }
          case '3':
            await quorumApi.close();
            break;
          case '4':
            await quorumApi.reset();
            break;
          case '5':
            await displayLedgerState(providers, quorumApi.deployedContract, logger);
            break;
          case '6':
            await displayPrivateState(providers, logger);
            break;
          case '7':
            displayDerivedState(currentState, logger);
            break;
          case '8':
            logger.info('Exiting...');
            return;
          default:
            logger.error(`Invalid choice: ${choice}`);
        }
      } catch (e) {
        logError(logger, e);
        logger.info('Returning to main menu...');
      }
    }
  } finally {
    // Errors bubble up to `run`, but the subscription must be disposed either way.
    subscription.unsubscribe();
  }
};

/*
 * Gives access to tokens minted in the genesis block of a local development
 * node. Only used on standalone networks, to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** Written by `npm run new-wallet`; gitignored. */
const SEED_FILE = path.resolve(process.cwd(), '..', '.wallet-seed.local');

const readSavedSeed = (): string | undefined => {
  if (!existsSync(SEED_FILE)) return undefined;
  return readFileSync(SEED_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
};

const buildWallet = async (config: Config, rli: Interface, logger: Logger): Promise<string | undefined> => {
  if (config instanceof StandaloneConfig) {
    return GENESIS_MINT_WALLET_SEED;
  }

  // The saved seed is offered first when present, since it is the wallet that
  // was funded from the faucet.
  const savedSeed = readSavedSeed();
  const options = savedSeed
    ? [
        'Use the saved wallet from .wallet-seed.local (the funded one)',
        'Build a fresh wallet',
        'Build wallet from a seed',
        'Exit',
      ]
    : ['Build a fresh wallet', 'Build wallet from a seed', 'Exit'];
  const question = `
You can do one of the following:
${options.map((option, i) => `  ${i + 1}. ${option}`).join('\n')}
Which would you like to do? `;

  while (true) {
    const choice = Number(await rli.question(question));
    const selected = options[choice - 1];
    switch (selected) {
      case 'Use the saved wallet from .wallet-seed.local (the funded one)':
        logger.info('Using the saved wallet seed.');
        return savedSeed;
      case 'Build a fresh wallet':
        return toHex(randomBytes(32));
      case 'Build wallet from a seed':
        return await rli.question('Enter your wallet seed: ');
      case 'Exit':
        logger.info('Exiting...');
        return undefined;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

/**
 * Main entry point. If given a Docker environment, waits for it to be ready
 * before doing anything else.
 */
export const run = async (config: Config, testEnv: TestEnvironment, logger: Logger): Promise<void> => {
  const rli = createInterface({ input, output, terminal: true });
  const providersToBeStopped: MidnightWalletProvider[] = [];
  try {
    const envConfiguration = await testEnv.start();
    logger.info(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);
    const seed = await buildWallet(config, rli, logger);
    if (seed === undefined) {
      return;
    }
    const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, seed);
    providersToBeStopped.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;

    await walletProvider.start();

    const unshieldedState = await waitForUnshieldedFunds(
      logger,
      walletFacade,
      envConfiguration,
      unshieldedToken(),
      config.fundFromFaucet,
    );
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined) {
      logger.info('No funds received, exiting...');
      return;
    }
    logger.info(`Your NIGHT wallet balance is: ${nightBalance}`);

    if (config.generateDust) {
      const dustGeneration = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustGeneration) {
        logger.info(`Submitted dust generation registration transaction: ${dustGeneration}`);
        await syncWallet(logger, walletFacade);
      }
    }

    const zkConfigProvider = new NodeZkConfigProvider<QuorumCircuits>(config.zkConfigPath);
    const providers: QuorumProviders = {
      privateStateProvider: levelPrivateStateProvider<PrivateStateId, QuorumPrivateState>({
        privateStateStoreName: config.privateStateStoreName,
        signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
        privateStoragePasswordProvider: () => {
          return 'Quorum-Test-2026!';
        },
        accountId: seed,
      }),
      publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
      zkConfigProvider: zkConfigProvider,
      proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
      walletProvider: walletProvider,
      midnightProvider: walletProvider,
    };
    await mainLoop(providers, rli, logger);
  } catch (e) {
    logError(logger, e);
    logger.info('Exiting...');
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logError(logger, e);
    } finally {
      try {
        for (const wallet of providersToBeStopped) {
          logger.info('Stopping wallet...');
          await wallet.stop();
        }
        if (testEnv) {
          logger.info('Stopping test environment...');
          await testEnv.shutdown();
        }
      } catch (e) {
        logError(logger, e);
      }
    }
  }
};

function logError(logger: Logger, e: unknown) {
  if (e instanceof Error) {
    logger.error(`Found error '${e.message}'`);
    logger.debug(`${e.stack}`);
  } else {
    logger.error(`Found error (unknown type)`);
  }
}
