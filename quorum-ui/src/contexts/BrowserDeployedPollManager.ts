// This file is part of Quorum, adapted from midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  QuorumAPI,
  type PrivateStateId,
  type QuorumCircuitKeys,
  type QuorumProviders,
  type DeployedQuorumAPI,
} from '../../../api/src/index';
import { type ContractAddress, fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  BehaviorSubject,
  catchError,
  concatMap,
  filter,
  firstValueFrom,
  interval,
  map,
  type Observable,
  take,
  tap,
  throwError,
  timeout,
} from 'rxjs';
import { pipe as fnPipe } from 'fp-ts/function';
import { type Logger } from 'pino';
import { ConnectedAPI, type InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import semver from 'semver';
import {
  Binding,
  FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
// Relative, like every other cross-workspace import here: the contract package
// is a workspace sibling that is not published, so its bare name does not resolve.
import { type QuorumPrivateState } from '../../../contract/src/index';
import { inMemoryPrivateStateProvider } from '../in-memory-private-state-provider';
import { NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';

/** A poll deployment that is being deployed or joined. */
export interface InProgressPollDeployment {
  readonly status: 'in-progress';
}

/** A poll deployment that resolved to a live contract. */
export interface DeployedPollDeployment {
  readonly status: 'deployed';
  readonly api: DeployedQuorumAPI;
}

/** A poll deployment that failed to resolve. */
export interface FailedPollDeployment {
  readonly status: 'failed';
  readonly error: Error;
}

export type PollDeployment = InProgressPollDeployment | DeployedPollDeployment | FailedPollDeployment;

/**
 * The state of the Lace wallet connection.
 *
 * @remarks
 * Modelled explicitly rather than inferred from the presence of providers,
 * because the UI has to distinguish "not connected yet" from "connecting" from
 * "the user rejected the connection" — and because disconnect has to be able to
 * put us back in `disconnected` deliberately.
 */
export type WalletConnectionState =
  | { readonly status: 'disconnected' }
  | { readonly status: 'connecting' }
  | { readonly status: 'connected'; readonly coinPublicKey: string }
  | { readonly status: 'failed'; readonly error: Error };

/** Provides access to Quorum poll deployments and the wallet they run through. */
export interface DeployedPollAPIProvider {
  readonly pollDeployments$: Observable<Array<Observable<PollDeployment>>>;
  readonly walletState$: Observable<WalletConnectionState>;

  /** Connects to the Lace wallet, building the provider set behind it. */
  readonly connect: () => Promise<void>;

  /**
   * Drops the wallet connection and every deployment that ran through it.
   *
   * @remarks
   * The providers are cached deliberately (see `getProviders`), so disconnect
   * has to evict that cache — otherwise a reconnect would silently reuse the
   * previous wallet's keys and private state.
   */
  readonly disconnect: () => void;

  readonly resolve: (contractAddress?: ContractAddress) => Observable<PollDeployment>;
}

/**
 * A {@link DeployedPollAPIProvider} that manages Quorum deployments in a browser.
 *
 * @remarks
 * Configures and manages a connection to the Midnight Lace wallet, along with
 * the providers that only make sense in a web-browser setting.
 */
export class BrowserDeployedPollManager implements DeployedPollAPIProvider {
  readonly #pollDeploymentsSubject: BehaviorSubject<Array<BehaviorSubject<PollDeployment>>>;
  readonly #walletStateSubject: BehaviorSubject<WalletConnectionState>;
  #initializedProviders: Promise<QuorumProviders> | undefined;

  constructor(private readonly logger: Logger) {
    this.#pollDeploymentsSubject = new BehaviorSubject<Array<BehaviorSubject<PollDeployment>>>([]);
    this.pollDeployments$ = this.#pollDeploymentsSubject;
    this.#walletStateSubject = new BehaviorSubject<WalletConnectionState>({ status: 'disconnected' });
    this.walletState$ = this.#walletStateSubject;
  }

  /** @inheritdoc */
  readonly pollDeployments$: Observable<Array<Observable<PollDeployment>>>;

  /** @inheritdoc */
  readonly walletState$: Observable<WalletConnectionState>;

  /** @inheritdoc */
  connect = async (): Promise<void> => {
    if (this.#walletStateSubject.value.status === 'connecting') {
      return;
    }

    this.#walletStateSubject.next({ status: 'connecting' });
    try {
      const providers = await this.getProviders();
      this.#walletStateSubject.next({
        status: 'connected',
        coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      });
    } catch (error: unknown) {
      // Evict the rejected promise, or every later retry would await the same failure.
      this.#initializedProviders = undefined;
      this.#walletStateSubject.next({
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  };

  /** @inheritdoc */
  disconnect = (): void => {
    this.#initializedProviders = undefined;
    // Deployments hold an API bound to the old providers, so they go too. The
    // private state lived in memory only, so dropping it drops the secret key
    // as well — a disconnect really does forget the voting identity.
    for (const deployment of this.#pollDeploymentsSubject.value) {
      deployment.complete();
    }
    this.#pollDeploymentsSubject.next([]);
    this.#walletStateSubject.next({ status: 'disconnected' });
    this.logger.info('Disconnected from wallet; cleared providers and deployments');
  };

  /** @inheritdoc */
  resolve(contractAddress?: ContractAddress): Observable<PollDeployment> {
    const deployments = this.#pollDeploymentsSubject.value;
    let deployment = deployments.find(
      (deployment) =>
        deployment.value.status === 'deployed' && deployment.value.api.deployedContractAddress === contractAddress,
    );

    if (deployment) {
      return deployment;
    }

    deployment = new BehaviorSubject<PollDeployment>({
      status: 'in-progress',
    });

    if (contractAddress) {
      void this.joinDeployment(deployment, contractAddress);
    } else {
      void this.deployDeployment(deployment);
    }

    this.#pollDeploymentsSubject.next([...deployments, deployment]);

    return deployment;
  }

  private getProviders(): Promise<QuorumProviders> {
    // We use a cached `Promise` to hold the providers. This will:
    //
    // 1. Cache and re-use the providers (including the configured connector API), and
    // 2. Act as a synchronization point if multiple contract deploys or joins run concurrently.
    //    Concurrent calls to `getProviders()` will receive, and ultimately await, the same
    //    `Promise`.
    return this.#initializedProviders ?? (this.#initializedProviders = initializeProviders(this.logger));
  }

  private async deployDeployment(deployment: BehaviorSubject<PollDeployment>): Promise<void> {
    try {
      const providers = await this.getProviders();
      const api = await QuorumAPI.deploy(providers, this.logger);

      deployment.next({ status: 'deployed', api });
    } catch (error: unknown) {
      deployment.next({
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private async joinDeployment(
    deployment: BehaviorSubject<PollDeployment>,
    contractAddress: ContractAddress,
  ): Promise<void> {
    try {
      const providers = await this.getProviders();
      const api = await QuorumAPI.join(providers, contractAddress, this.logger);

      deployment.next({ status: 'deployed', api });
    } catch (error: unknown) {
      deployment.next({
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
/** @internal */
const initializeProviders = async (logger: Logger): Promise<QuorumProviders> => {
  const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
  const connectedAPI = await connectToWallet(logger, networkId);
  const zkConfigPath = window.location.origin;
  const keyMaterialProvider = new FetchZkConfigProvider<QuorumCircuitKeys>(zkConfigPath, fetch.bind(window));
  const config = await connectedAPI.getConfiguration();
  // In-memory, and deliberately so: the secret key that derives this user's
  // nullifier lives here and nowhere else. Closing the tab forgets it. Keyed by
  // the literal `PrivateStateId` rather than `string`, because the provider set
  // is typed against that literal and widening it here made the assignment
  // unsound.
  const privateStateProvider = inMemoryPrivateStateProvider<PrivateStateId, QuorumPrivateState>();
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  return {
    privateStateProvider,
    zkConfigProvider: keyMaterialProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri!, keyMaterialProvider),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider: {
      getCoinPublicKey(): string {
        return shieldedAddresses.shieldedCoinPublicKey;
      },
      getEncryptionPublicKey(): string {
        return shieldedAddresses.shieldedEncryptionPublicKey;
      },
      balanceTx: async (tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> => {
        try {
          logger.info({ tx, ttl }, 'Balancing transaction via wallet');
          const serializedTx = toHex(tx.serialize());
          const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
          return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
            'signature',
            'proof',
            'binding',
            fromHex(received.tx),
          );
        } catch (e) {
          logger.error({ error: e }, 'Error balancing transaction via wallet');
          throw e;
        }
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        const txIdentifiers = tx.identifiers();
        const txId = txIdentifiers[0]; // Return the first transaction ID
        logger.info({ txIdentifiers }, 'Submitted transaction via wallet');
        return txId;
      },
    },
  };
};

/** @internal */
const getFirstCompatibleWallet = (): InitialAPI | undefined => {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      semver.satisfies(wallet.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

/** @internal */
const connectToWallet = (logger: Logger, networkId: string): Promise<ConnectedAPI> => {
  return firstValueFrom(
    fnPipe(
      interval(100),
      map(() => getFirstCompatibleWallet()),
      tap((connectorAPI) => {
        logger.info(connectorAPI, 'Check for wallet connector API');
      }),
      filter((connectorAPI): connectorAPI is InitialAPI => !!connectorAPI),
      tap((connectorAPI) => {
        logger.info(connectorAPI, 'Compatible wallet connector API found. Connecting.');
      }),
      take(1),
      timeout({
        first: 1_000,
        with: () =>
          throwError(() => {
            logger.error('Could not find wallet connector API');

            return new Error('Could not find Midnight Lace wallet. Extension installed?');
          }),
      }),
      concatMap(async (initialAPI) => {
        const connectedAPI = await initialAPI.connect(networkId);
        const connectionStatus = await connectedAPI.getConnectionStatus();
        logger.info(connectionStatus, 'Wallet connector API enabled status');
        return connectedAPI;
      }),
      timeout({
        first: 60_000,
        with: () =>
          throwError(() => {
            logger.error('Wallet connector API has failed to respond');

            return new Error('Midnight Lace wallet has failed to respond. Extension enabled?');
          }),
      }),
      catchError((error, apis) =>
        error
          ? throwError(() => {
              logger.error('Unable to enable connector API' + error);
              return new Error('Application is not authorized');
            })
          : apis,
      ),
    ),
  );
};
