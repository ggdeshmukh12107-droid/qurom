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

// import { webcrypto } from 'crypto';

import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Logger } from 'pino';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as rx from 'rxjs';

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const generateDust = async (
  logger: Logger,
  walletSeed: string,
  unshieldedState: UnshieldedWalletState,
  walletFacade: WalletFacade,
) => {
  // Deliberately NOT dust.waitForSyncedState(): on Preprod the dust sub-wallet
  // never reports strictly-synced before it holds any dust, so that call blocks
  // forever on a wallet whose whole purpose here is to acquire its first dust.
  // The first state emission carries the address, which is all we need.
  const dustState = await rx.firstValueFrom(walletFacade.dust.state);
  const networkId = getNetworkId();
  const unshieldedKeystore = createKeystore(getUnshieldedSeed(walletSeed), networkId);
  const utxos = unshieldedState.availableCoins;
  const unregistered = utxos.filter((coin) => !coin.meta.registeredForDustGeneration);

  let txId: string | undefined;

  if (unregistered.length === 0) {
    // Already registered by an earlier run. Registration is the slow part, so
    // this is the good case — but it is NOT a reason to skip the wait below:
    // registered NIGHT still needs time on-chain before the dust it generates
    // is spendable, and returning early here is what left the deploy trying to
    // pay fees from a zero balance.
    logger.info(`All ${utxos.length} NIGHT UTXO(s) are already registered for dust generation.`);
  } else {
    logger.info(`Generating dust with ${unregistered.length} UTXOs...`);

    // The registration transaction has to pay its own fee, and fees are paid in
    // DUST — which is the very thing registration exists to unlock. Midnight
    // resolves that circularity by having NIGHT *project* dust generation
    // before it is formally registered: estimate the fee first, wait until the
    // projected dust covers it, and only then submit. Registering immediately
    // (the obvious ordering) produces a transaction that can never pay for
    // itself, so the node drops it and the balance sits at 0 with no error.
    const { fee } = await walletFacade.estimateRegistration(unregistered);
    logger.info(`Registration fee: ${fee}. Waiting for projected dust to cover it...`);

    await walletFacade.waitForGeneratedDust(unregistered, fee, { timeoutMs: 900_000 });
    logger.info('Projected dust now covers the registration fee; submitting registration.');

    const recipe = await walletFacade.registerNightUtxosForDustGeneration(
      unregistered,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
      dustState.address,
    );
    const transaction = await walletFacade.finalizeRecipe(recipe);
    txId = await walletFacade.submitTransaction(transaction);
    logger.info(`Dust generation transaction submitted with txId: ${txId}`);
  }

  // Wait for spendable dust regardless of which branch ran above. A non-zero
  // balance is not enough on its own — the deploy failed at "could not balance
  // dust" while holding a trickle — so hold out for a threshold that can
  // actually cover a contract deployment plus a few circuit calls.
  const REQUIRED_DUST = 1_000_000_000n;
  const DUST_TIMEOUT_MS = 900_000;
  const dustBalance = await rx.firstValueFrom(
    walletFacade.state().pipe(
      rx.throttleTime(10_000),
      rx.map((s) => s.dust.balance(new Date())),
      rx.tap((balance) => logger.info(`Waiting for dust: balance=${balance} target=${REQUIRED_DUST}`)),
      rx.filter((balance) => balance >= REQUIRED_DUST),
      rx.timeout({
        first: DUST_TIMEOUT_MS,
        with: () =>
          rx.throwError(
            () =>
              new Error(
                `Dust did not reach ${REQUIRED_DUST} within ${DUST_TIMEOUT_MS / 1000}s. ` +
                  `Fees cannot be paid without dust.`,
              ),
          ),
      }),
    ),
  );
  logger.info(`Dust available: ${dustBalance}`);

  return txId;
};
