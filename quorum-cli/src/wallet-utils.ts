/*
 * This file is part of Quorum, adapted from midnightntwrk/example-bboard.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { UnshieldedTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { type FacadeState, type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { type ShieldedWalletAPI, type ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWalletAPI, type UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';

import { FaucetClient, type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { Logger } from 'pino';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export const getInitialShieldedState = async (
  logger: Logger,
  wallet: ShieldedWalletAPI,
): Promise<ShieldedWalletState> => {
  logger.info('Getting initial state of wallet...');
  return Rx.firstValueFrom(wallet.state);
};

export const getInitialUnshieldedState = async (
  logger: Logger,
  wallet: UnshieldedWalletAPI,
): Promise<UnshieldedWalletState> => {
  logger.info('Getting initial state of wallet...');
  return Rx.firstValueFrom(wallet.state);
};

const isProgressStrictlyComplete = (progress: unknown): boolean => {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
};

const isFacadeStateSynced = (state: FacadeState): boolean =>
  isProgressStrictlyComplete(state.shielded.state.progress) &&
  isProgressStrictlyComplete(state.dust.state.progress) &&
  isProgressStrictlyComplete(state.unshielded.progress);

/**
 * A one-line, human-readable sync summary. Logged at INFO on purpose: these
 * waits can run for minutes, and a silent process is indistinguishable from a
 * hung one.
 */
const describeProgress = (state: FacadeState): string => {
  const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
  const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
  const dust = isProgressStrictlyComplete(state.dust.state.progress);
  return `shielded=${shielded} unshielded=${unshielded} dust=${dust}`;
};

export const syncWallet = (logger: Logger, wallet: WalletFacade, throttleTime = 2_000, timeoutMs = 300_000) => {
  logger.info('Syncing wallet...');

  const synced = wallet.state().pipe(
    Rx.throttleTime(throttleTime),
    Rx.tap((state: FacadeState) => {
      logger.info(`Sync progress: ${describeProgress(state)}`);
    }),
    Rx.filter((state: FacadeState) => isFacadeStateSynced(state)),
    Rx.tap(() => logger.info('Sync complete')),
    Rx.tap((state: FacadeState) => {
      const shieldedBalances = state.shielded.balances || {};
      const unshieldedBalances = state.unshielded.balances || {};
      const dustBalances = state.dust.balance(new Date(Date.now())) || 0n;

      logger.info(
        `Wallet balances after sync - Shielded: ${JSON.stringify(shieldedBalances)}, Unshielded: ${JSON.stringify(unshieldedBalances)}, Dust: ${dustBalances}`,
      );
    }),
  );

  // Strict sync can stay false indefinitely on a public network. Falling back
  // to the latest state keeps a deploy moving instead of hanging silently; the
  // caller's own balance checks decide whether that state is good enough.
  const fallback = Rx.timer(timeoutMs).pipe(
    Rx.tap(() => logger.warn(`Wallet did not report strict sync within ${timeoutMs / 1000}s; using latest state.`)),
    Rx.switchMap(() => wallet.state().pipe(Rx.take(1))),
  );

  return Rx.firstValueFrom(Rx.race(synced, fallback));
};

export const waitForUnshieldedFunds = async (
  logger: Logger,
  wallet: WalletFacade,
  env: EnvironmentConfiguration,
  tokenType: UnshieldedTokenType,
  fundFromFaucet = false,
  throttleTime = 2_000,
  fundsTimeoutMs = 600_000,
): Promise<UnshieldedWalletState> => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  const unshieldedAddress = UnshieldedAddress.codec.encode(getNetworkId(), initialState.address);
  logger.info(`Using unshielded address: ${unshieldedAddress.toString()} waiting for funds...`);
  const initialBalance = initialState.balances[tokenType.raw];
  if (initialBalance === undefined || initialBalance === 0n) {
    // The faucet request sits inside the empty-balance branch on purpose. A
    // wallet the user has already funded is left alone rather than asked for
    // more, and there is no point requesting tokens we would not then wait for.
    if (fundFromFaucet && env.faucet) {
      logger.info('Wallet is empty; requesting tokens from the faucet...');
      try {
        await new FaucetClient(env.faucet, logger).requestTokens(unshieldedAddress.toString());
      } catch (e) {
        // A rate-limited or unavailable faucet is not fatal: funds may still
        // arrive from elsewhere, so fall through to waiting rather than exiting.
        logger.warn(`Faucet request failed (${e instanceof Error ? e.message : 'unknown error'}); waiting anyway.`);
      }
    }
    logger.info(`Your wallet initial balance is: 0 (not yet initialized)`);
    logger.info(`Waiting to receive tokens...`);
    // Gate on the balance alone, not on strict whole-facade sync. Requiring
    // shielded+dust+unshielded to all report strictly complete meant a wallet
    // that had visibly received its NIGHT still waited forever, because the
    // dust sub-wallet never flipped. The balance is what the caller needs.
    const funded = await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(throttleTime),
        Rx.tap((state: FacadeState) => {
          const balance = state.unshielded.balances[tokenType.raw] ?? 0n;
          logger.info(`Waiting for funds: balance=${balance.toString()} ${describeProgress(state)}`);
        }),
        Rx.filter((state: FacadeState) => (state.unshielded.balances[tokenType.raw] ?? 0n) > 0n),
        Rx.tap((state: FacadeState) => {
          const unshieldedBalances = state.unshielded.balances || {};
          const dustBalances = state.dust.balance(new Date(Date.now())) || 0n;
          logger.info(`Funds received - Unshielded: ${JSON.stringify(unshieldedBalances)}, Dust: ${dustBalances}`);
        }),
        Rx.map((state: FacadeState) => state.unshielded),
        Rx.timeout({
          first: fundsTimeoutMs,
          with: () =>
            Rx.throwError(
              () =>
                new Error(
                  `No tNIGHT arrived at ${unshieldedAddress.toString()} within ${fundsTimeoutMs / 1000}s. ` +
                    `Fund that address and re-run.`,
                ),
            ),
        }),
      ),
    );
    return funded;
  }
  return initialState;
};
