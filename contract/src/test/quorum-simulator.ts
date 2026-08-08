import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  convertFieldToBytes,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
} from "../managed/quorum/contract/index.js";
import { type QuorumPrivateState, witnesses } from "../witnesses.js";

/**
 * A testbed for exercising the Quorum contract without a chain or a proof
 * server. Each method mirrors one circuit and threads the resulting circuit
 * context forward, so a sequence of calls behaves like a sequence of
 * transactions against the same deployed contract.
 */
export class QuorumSimulator {
  readonly contract: Contract<QuorumPrivateState>;
  circuitContext: CircuitContext<QuorumPrivateState>;

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<QuorumPrivateState>(witnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext({ secretKey }, "0".repeat(64)),
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  /**
   * Swap in a different secret key, standing in for a different participant.
   * Only the private state changes; the ledger is shared, exactly as it would
   * be for two people transacting against one deployed contract.
   */
  public switchUser(secretKey: Uint8Array) {
    this.circuitContext.currentPrivateState = { secretKey };
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): QuorumPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public open(question: string): Ledger {
    this.circuitContext = this.contract.impureCircuits.open(
      this.circuitContext,
      question,
    ).context;
    return this.getLedger();
  }

  public vote(choice: boolean): Ledger {
    this.circuitContext = this.contract.impureCircuits.vote(
      this.circuitContext,
      choice,
    ).context;
    return this.getLedger();
  }

  public close(): Ledger {
    this.circuitContext = this.contract.impureCircuits.close(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  public reset(): Ledger {
    this.circuitContext = this.contract.impureCircuits.reset(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  /** The current round, as the `Bytes<32>` the hash circuits expect. */
  private roundBytes(): Uint8Array {
    return convertFieldToBytes(
      32,
      this.getLedger().round,
      "quorum-simulator.ts",
    );
  }

  /**
   * The nullifier the current user would publish if they voted right now.
   * Tests use it to assert what does — and does not — land on the ledger.
   */
  public voteNullifier(): Uint8Array {
    return this.contract.circuits.voteNullifier(
      this.circuitContext,
      this.getPrivateState().secretKey,
      this.roundBytes(),
    ).result;
  }

  public organizerKey(): Uint8Array {
    return this.contract.circuits.organizerKey(
      this.circuitContext,
      this.getPrivateState().secretKey,
      this.roundBytes(),
    ).result;
  }
}
