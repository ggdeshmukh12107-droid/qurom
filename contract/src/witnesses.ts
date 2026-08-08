/*
 * The shape of Quorum's private state, and the single witness function that
 * reads it.
 *
 * This file is the whole privacy boundary on the TypeScript side: `secretKey`
 * is the one value the circuits use but never disclose. It is fed into
 * `voteNullifier`/`organizerKey` inside the ZK circuit, and only the hash comes
 * out. It never reaches the ledger, a transaction, or the indexer.
 */

import { Ledger } from "./managed/quorum/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type QuorumPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createQuorumPrivateState = (secretKey: Uint8Array) => ({
  secretKey,
});

/*
 * Each witness implementation takes a WitnessContext<L, PS> first — with
 * `ledger`, `privateState` and `contractAddress` fields — followed by the
 * arguments declared in Compact. It returns a tuple of the (possibly updated)
 * private state and the declared return value.
 *
 * `localSecretKey` needs neither the ledger nor the contract address, and it
 * never mutates private state: it hands back the same state it was given.
 */
export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, QuorumPrivateState>): [
    QuorumPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
};
