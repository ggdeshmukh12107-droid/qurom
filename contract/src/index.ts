import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

export * from "./managed/quorum/contract/index.js";
export * from "./witnesses";

import * as CompiledQuorumContract from "./managed/quorum/contract/index.js";
import * as Witnesses from "./witnesses";

export const CompiledQuorumContractContract = CompiledContract.make<
  CompiledQuorumContract.Contract<Witnesses.QuorumPrivateState>
>("Quorum", CompiledQuorumContract.Contract<Witnesses.QuorumPrivateState>).pipe(
  CompiledContract.withWitnesses(Witnesses.witnesses),
  CompiledContract.withCompiledFileAssets("./managed/quorum"),
);
