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

import { useEffect, useState } from 'react';
import { type WalletConnectionState } from '../contexts';
import { useDeployedPollContext } from './useDeployedPollContext';

/** What {@link useWalletConnection} hands back to a component. */
export interface WalletConnection {
  readonly state: WalletConnectionState;
  readonly isConnected: boolean;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
}

/**
 * Subscribes to the wallet connection and exposes connect/disconnect.
 *
 * @remarks
 * The header needs this to render the button, and the poll needs it to know
 * whether a circuit call is even possible. Both read the same
 * `BehaviorSubject` on the manager, so they cannot disagree about whether a
 * wallet is attached.
 *
 * @internal
 */
export const useWalletConnection = (): WalletConnection => {
  const pollApiProvider = useDeployedPollContext();
  const [state, setState] = useState<WalletConnectionState>({ status: 'disconnected' });

  useEffect(() => {
    const subscription = pollApiProvider.walletState$.subscribe(setState);

    return () => {
      subscription.unsubscribe();
    };
  }, [pollApiProvider]);

  return {
    state,
    isConnected: state.status === 'connected',
    connect: pollApiProvider.connect,
    disconnect: pollApiProvider.disconnect,
  };
};
