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

import React, { type PropsWithChildren, createContext, useState } from 'react';
import { type DeployedPollAPIProvider, BrowserDeployedPollManager } from './BrowserDeployedPollManager';
import { type Logger } from 'pino';

/**
 * Encapsulates a deployed polls provider as a context object.
 */
export const DeployedPollContext = createContext<DeployedPollAPIProvider | undefined>(undefined);

/**
 * The props required by the {@link DeployedPollProvider} component.
 */
export type DeployedPollProviderProps = PropsWithChildren<{
  /** The `pino` logger to use. */
  logger: Logger;
}>;

/**
 * Sets a {@link BrowserDeployedPollManager} as the in-scope deployed poll provider.
 *
 * @remarks
 * The manager is held in `useState` so that it survives re-renders. Constructing
 * it inline would hand every render a new manager, which would drop the wallet
 * connection and the in-memory private state along with it.
 */
export const DeployedPollProvider: React.FC<Readonly<DeployedPollProviderProps>> = ({ logger, children }) => {
  const [manager] = useState(() => new BrowserDeployedPollManager(logger));

  return <DeployedPollContext.Provider value={manager}>{children}</DeployedPollContext.Provider>;
};
