import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum PollState { DRAFT = 0, OPEN = 1, CLOSED = 2 }

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  open(context: __compactRuntime.CircuitContext<PS>, newQuestion_0: string): __compactRuntime.CircuitResults<PS, []>;
  vote(context: __compactRuntime.CircuitContext<PS>, choice_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  close(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  reset(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  open(context: __compactRuntime.CircuitContext<PS>, newQuestion_0: string): __compactRuntime.CircuitResults<PS, []>;
  vote(context: __compactRuntime.CircuitContext<PS>, choice_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  close(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  reset(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  organizerKey(sk_0: Uint8Array, round_0: Uint8Array): Uint8Array;
  voteNullifier(sk_0: Uint8Array, round_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  open(context: __compactRuntime.CircuitContext<PS>, newQuestion_0: string): __compactRuntime.CircuitResults<PS, []>;
  vote(context: __compactRuntime.CircuitContext<PS>, choice_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  close(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  reset(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  organizerKey(context: __compactRuntime.CircuitContext<PS>,
               sk_0: Uint8Array,
               round_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  voteNullifier(context: __compactRuntime.CircuitContext<PS>,
                sk_0: Uint8Array,
                round_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  readonly state: PollState;
  readonly question: { is_some: boolean, value: string };
  readonly yesVotes: bigint;
  readonly noVotes: bigint;
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly organizer: Uint8Array;
  readonly round: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
