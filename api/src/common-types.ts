/**
 * Quorum common types and abstractions.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { PollState, QuorumPrivateState, Contract, Witnesses } from '../../contract/src/index';

export const quorumPrivateStateKey = 'quorumPrivateState';
export type PrivateStateId = typeof quorumPrivateStateKey;

/**
 * The private states consumed throughout the application.
 *
 * @remarks
 * {@link PrivateStates} can be thought of as a type that describes a schema for all
 * private states for all contracts used in the application. Each key represents
 * the type of private state consumed by a particular type of contract.
 * The key is used by the deployed contract when interacting with a private state provider,
 * and the type (i.e., `typeof PrivateStates[K]`) represents the type of private state
 * expected to be returned.
 *
 * Quorum has a single contract type, so the schema has a single key.
 *
 * @public
 */
export type PrivateStates = {
  /**
   * Key used to provide the private state for {@link QuorumContract} deployments.
   */
  readonly quorumPrivateState: QuorumPrivateState;
};

/**
 * Represents a Quorum contract and its private state.
 *
 * @public
 */
export type QuorumContract = Contract<QuorumPrivateState, Witnesses<QuorumPrivateState>>;

/**
 * The keys of the circuits exported from {@link QuorumContract}.
 *
 * @public
 */
export type QuorumCircuitKeys = Exclude<keyof QuorumContract['impureCircuits'], number | symbol>;

/**
 * The providers required by {@link QuorumContract}.
 *
 * @public
 */
export type QuorumProviders = MidnightProviders<QuorumCircuitKeys, PrivateStateId, QuorumPrivateState>;

/**
 * A {@link QuorumContract} that has been deployed to the network.
 *
 * @public
 */
export type DeployedQuorumContract = FoundContract<QuorumContract>;

/**
 * The derived combination of public (ledger) and private state.
 *
 * @remarks
 * Everything up to `nullifierCount` is read straight off the ledger, and is
 * public to anyone with the contract address. The final three fields are
 * derived locally by combining the ledger with the user's secret key — they
 * are answers the chain itself cannot give, because it never learns the key.
 */
export type QuorumDerivedState = {
  readonly state: PollState;
  readonly question: string | undefined;
  readonly yesVotes: bigint;
  readonly noVotes: bigint;
  readonly round: bigint;

  /**
   * How many distinct people have voted this round.
   *
   * @remarks
   * This is the size of the on-chain nullifier set. It is the total the chain
   * can prove; it cannot name any of the individuals it counts.
   */
  readonly nullifierCount: bigint;

  /**
   * This user's nullifier for the current round, as hex.
   *
   * @remarks
   * Derived locally from the secret key. Displaying it is safe — it is a
   * one-way hash — and it is what makes the privacy claim observable: the same
   * value is visible in the on-chain set once the user votes, and it changes
   * completely when the round advances.
   */
  readonly myNullifier: string;

  /**
   * Whether this user has already voted in the current round.
   *
   * @remarks
   * Computed by checking the locally derived nullifier against the on-chain
   * set. Only the holder of the secret key can compute this, which is why the
   * UI can show "you have voted" while the chain cannot.
   */
  readonly hasVoted: boolean;

  /**
   * Whether this user opened the current poll.
   */
  readonly isOrganizer: boolean;
};
