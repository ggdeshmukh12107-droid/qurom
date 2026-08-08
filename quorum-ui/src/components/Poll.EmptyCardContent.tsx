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

import React, { useState } from 'react';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { Box, Button, CardContent, Typography } from '@mui/material';
import BallotIcon from '@mui/icons-material/HowToVoteOutlined';
import { TextPromptDialog } from './TextPromptDialog';

/**
 * The poll already deployed to this network, if the build was given one.
 *
 * @remarks
 * A visitor with no poll of their own can still see the privacy behaviour work
 * against real on-chain state, which is the whole point of the demo. Reading it
 * once at module scope is fine: Vite substitutes it at build time.
 */
const LIVE_POLL_ADDRESS: ContractAddress | undefined = import.meta.env.VITE_QUORUM_CONTRACT_ADDRESS;

/**
 * The props required by the {@link EmptyPollContent} component.
 *
 * @internal
 */
export interface EmptyPollContentProps {
  /** Called to deploy a new poll contract. */
  onCreatePollCallback: () => void;
  /** Called to join an existing poll contract. */
  onJoinPollCallback: (contractAddress: ContractAddress) => void;
  /** Whether the wallet is connected; both actions need it. */
  isWalletConnected: boolean;
}

/**
 * Rendered when there is no poll deployment yet: lets the user start a poll or
 * join one someone else started.
 *
 * @internal
 */
export const EmptyPollContent: React.FC<Readonly<EmptyPollContentProps>> = ({
  onCreatePollCallback,
  onJoinPollCallback,
  isWalletConnected,
}) => {
  const [textPromptOpen, setTextPromptOpen] = useState(false);

  return (
    <React.Fragment>
      <CardContent sx={{ textAlign: 'center', pt: 5 }}>
        <BallotIcon sx={{ fontSize: 56, color: 'primary.dark' }} />
        <Typography variant="h6" color="primary" sx={{ mt: 1 }}>
          Start a pulse poll
        </Typography>
        <Typography data-testid="poll-empty-message" variant="body2" color="primary.dark" sx={{ mt: 1 }}>
          {isWalletConnected
            ? 'Join the live poll, deploy your own, or enter a contract address.'
            : 'Connect your Lace wallet to deploy or join a poll.'}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
          {LIVE_POLL_ADDRESS !== undefined && (
            <Button
              data-testid="poll-join-live-btn"
              variant="contained"
              disabled={!isWalletConnected}
              onClick={() => {
                onJoinPollCallback(LIVE_POLL_ADDRESS);
              }}
            >
              Join the live poll
            </Button>
          )}
          <Button
            data-testid="poll-deploy-btn"
            variant={LIVE_POLL_ADDRESS === undefined ? 'contained' : 'outlined'}
            disabled={!isWalletConnected}
            onClick={onCreatePollCallback}
          >
            Deploy a new poll
          </Button>
          <Button
            data-testid="poll-join-btn"
            variant="outlined"
            disabled={!isWalletConnected}
            onClick={() => {
              setTextPromptOpen(true);
            }}
          >
            Join an existing poll
          </Button>
        </Box>
      </CardContent>
      <TextPromptDialog
        prompt="Enter contract address"
        isOpen={textPromptOpen}
        onCancel={() => {
          setTextPromptOpen(false);
        }}
        onSubmit={(text) => {
          setTextPromptOpen(false);
          onJoinPollCallback(text);
        }}
      />
    </React.Fragment>
  );
};
