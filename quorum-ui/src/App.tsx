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

import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { MainLayout, Poll } from './components';
import { useDeployedPollContext, useWalletConnection } from './hooks';
import { type PollDeployment } from './contexts';
import { type Observable } from 'rxjs';

/**
 * The root Quorum application component.
 *
 * @remarks
 * Requires a `<DeployedPollProvider />` parent in order to retrieve information
 * about current poll deployments. The wallet connection is read here as well as
 * in the header, because a poll cannot call a circuit without one and the
 * buttons should say so rather than failing on click.
 *
 * @internal
 */
const App: React.FC = () => {
  const pollApiProvider = useDeployedPollContext();
  const { isConnected } = useWalletConnection();
  const [pollDeployments, setPollDeployments] = useState<Array<Observable<PollDeployment>>>([]);

  useEffect(() => {
    const subscription = pollApiProvider.pollDeployments$.subscribe(setPollDeployments);

    return () => {
      subscription.unsubscribe();
    };
  }, [pollApiProvider]);

  return (
    <Box sx={{ background: '#000', minHeight: '100vh' }}>
      <MainLayout>
        {pollDeployments.map((pollDeployment, idx) => (
          <div data-testid={`poll-${idx}`} key={`poll-${idx}`}>
            <Poll pollDeployment$={pollDeployment} isWalletConnected={isConnected} />
          </div>
        ))}
        <div data-testid="poll-start">
          <Poll isWalletConnected={isConnected} />
        </div>
      </MainLayout>
    </Box>
  );
};

export default App;
