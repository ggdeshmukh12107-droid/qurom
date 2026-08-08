/**
 * Provides types and utilities for working with Quorum polling contracts.
 *
 * @packageDocumentation
 */

import * as Quorum from '../../contract/src/managed/quorum/contract/index.js';

import { type ContractAddress, convertFieldToBytes } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import {
  type QuorumDerivedState,
  type QuorumContract,
  type QuorumProviders,
  type DeployedQuorumContract,
  quorumPrivateStateKey,
} from './common-types.js';
import { CompiledQuorumContractContract } from '../../contract/src/index';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { QuorumPrivateState, createQuorumPrivateState } from '../../contract/src/witnesses.js';

/**
 * An API for a deployed Quorum poll.
 */
export interface DeployedQuorumAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<QuorumDerivedState>;

  open: (question: string) => Promise<void>;
  vote: (choice: boolean) => Promise<void>;
  close: () => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Implements {@link DeployedQuorumAPI} by adapting a deployed Quorum contract.
 *
 * @remarks
 * The `QuorumPrivateState` is managed at the DApp level by a private state
 * provider, and holds the single value that must never leave the browser: the
 * user's secret key. It identifies the user for both roles — deriving their
 * vote nullifier and their organizer key — without ever being transmitted.
 */
export class QuorumAPI implements DeployedQuorumAPI {
  /** @internal */
  private constructor(
    public readonly deployedContract: DeployedQuorumContract,
    providers: QuorumProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.state$ = combineLatest(
      [
        // Combine public (ledger) state with...
        providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
          map((contractState) => Quorum.ledger(contractState.data)),
          tap((ledgerState) =>
            logger?.trace({
              ledgerStateChanged: {
                ledgerState: {
                  state: pollStateLabel(ledgerState.state),
                  question: ledgerState.question.value,
                  yesVotes: ledgerState.yesVotes,
                  noVotes: ledgerState.noVotes,
                  round: ledgerState.round,
                  nullifierCount: ledgerState.nullifiers.size(),
                  organizer: toHex(ledgerState.organizer),
                },
              },
            }),
          ),
        ),
        // ...private state.
        //    Quorum's private state never changes after creation, so a single
        //    query suffices. If it could change, this would need to be an
        //    Observable.
        from(providers.privateStateProvider.get(quorumPrivateStateKey) as Promise<QuorumPrivateState>),
      ],
      // ...and derive the view state from both.
      (ledgerState, privateState) => {
        // Both derivations happen locally, in this process. The secret key is
        // an input to the pure circuits and never leaves: what comes back is a
        // one-way hash. This is precisely why `hasVoted` and `isOrganizer` can
        // be answered here but not by the chain.
        const round = convertFieldToBytes(32, ledgerState.round, 'api/src/index.ts');
        const myNullifier = Quorum.pureCircuits.voteNullifier(privateState.secretKey, round);
        const myOrganizerKey = Quorum.pureCircuits.organizerKey(privateState.secretKey, round);

        return {
          state: ledgerState.state,
          question: ledgerState.question.is_some ? ledgerState.question.value : undefined,
          yesVotes: ledgerState.yesVotes,
          noVotes: ledgerState.noVotes,
          round: ledgerState.round,
          nullifierCount: ledgerState.nullifiers.size(),
          myNullifier: toHex(myNullifier),
          hasVoted: ledgerState.nullifiers.member(myNullifier),
          isOrganizer: toHex(ledgerState.organizer) === toHex(myOrganizerKey),
        };
      },
    );
  }

  /**
   * Gets the address of the current deployed contract.
   */
  readonly deployedContractAddress: ContractAddress;

  /**
   * Gets an observable stream of state changes based on the current public
   * (ledger), and private state data.
   */
  readonly state$: Observable<QuorumDerivedState>;

  /**
   * Opens a new poll with the given question, making the caller its organizer.
   *
   * @remarks
   * Fails during local circuit execution if a poll is already open.
   */
  async open(question: string): Promise<void> {
    this.logger?.info(`openingPoll: ${question}`);

    const txData = await this.deployedContract.callTx.open(question);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'open',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Casts a vote in the current poll.
   *
   * @param choice `true` for Yes, `false` for No.
   *
   * @remarks
   * Fails during local circuit execution — before any transaction is built or
   * submitted — if no poll is open, or if this user's nullifier is already in
   * the on-chain set. A rejected double vote therefore costs nothing and
   * reveals nothing: no transaction ever reaches the network.
   *
   * Note what is *not* logged below. The tx hash and block height are public
   * anyway, but `choice` is deliberately omitted: writing it to the DApp's own
   * logs would reconstruct, off-chain, exactly the voter-to-vote link the
   * contract is designed to withhold.
   */
  async vote(choice: boolean): Promise<void> {
    this.logger?.info('castingVote');

    const txData = await this.deployedContract.callTx.vote(choice);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'vote',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Closes the current poll, freezing the tally.
   *
   * @remarks
   * Fails during local circuit execution if no poll is open, or if this user
   * is not the organizer that opened it.
   */
  async close(): Promise<void> {
    this.logger?.info('closingPoll');

    const txData = await this.deployedContract.callTx.close();

    this.logger?.trace({
      transactionAdded: {
        circuit: 'close',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Clears the poll and advances the round, making everyone eligible again.
   *
   * @remarks
   * Organizer only, and only once the poll is closed.
   */
  async reset(): Promise<void> {
    this.logger?.info('resettingPoll');

    const txData = await this.deployedContract.callTx.reset();

    this.logger?.trace({
      transactionAdded: {
        circuit: 'reset',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Deploys a new Quorum contract to the network.
   *
   * @param providers The Quorum providers.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link QuorumAPI} instance that
   * manages the newly deployed {@link DeployedQuorumContract}; or rejects with
   * a deployment error.
   */
  static async deploy(providers: QuorumProviders, logger?: Logger): Promise<QuorumAPI> {
    logger?.info('deployContract');

    const deployedQuorumContract = await deployContract(providers, {
      compiledContract: CompiledQuorumContractContract,
      privateStateId: quorumPrivateStateKey,
      initialPrivateState: createQuorumPrivateState(utils.randomBytes(32)),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedQuorumContract.deployTxData.public,
      },
    });

    return new QuorumAPI(deployedQuorumContract, providers, logger);
  }

  /**
   * Finds an already deployed Quorum contract on the network, and joins it.
   *
   * @param providers The Quorum providers.
   * @param contractAddress The contract address of the deployed Quorum contract to join.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link QuorumAPI} instance that
   * manages the joined {@link DeployedQuorumContract}; or rejects with an error.
   */
  static async join(providers: QuorumProviders, contractAddress: ContractAddress, logger?: Logger): Promise<QuorumAPI> {
    logger?.info({
      joinContract: {
        contractAddress,
      },
    });

    const deployedQuorumContract = await findDeployedContract<QuorumContract>(providers, {
      contractAddress,
      compiledContract: CompiledQuorumContractContract,
      privateStateId: quorumPrivateStateKey,
      initialPrivateState: await QuorumAPI.getPrivateState(providers, contractAddress),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedQuorumContract.deployTxData.public,
      },
    });

    return new QuorumAPI(deployedQuorumContract, providers, logger);
  }

  /**
   * Loads this user's private state, generating a fresh secret key on first
   * use. A new key means a new nullifier, i.e. a distinct voting identity.
   */
  private static async getPrivateState(
    providers: QuorumProviders,
    contractAddress: ContractAddress,
  ): Promise<QuorumPrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existingPrivateState = await providers.privateStateProvider.get(quorumPrivateStateKey);
    return existingPrivateState ?? createQuorumPrivateState(utils.randomBytes(32));
  }
}

/** Human-readable poll state, for logs and CLI output. */
export const pollStateLabel = (state: Quorum.PollState): string =>
  state === Quorum.PollState.OPEN ? 'open' : state === Quorum.PollState.CLOSED ? 'closed' : 'draft';

/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
