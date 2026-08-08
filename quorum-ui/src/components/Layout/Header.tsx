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

import React from 'react';
import { AppBar, Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import { useWalletConnection } from '../../hooks';

/** Renders a public key as `abcd…wxyz`; the full value is in the tooltip. */
const abbreviate = (key: string): string => (key.length <= 14 ? key : `${key.slice(0, 8)}…${key.slice(-6)}`);

/**
 * The application header, carrying the wallet connect/disconnect control.
 *
 * @remarks
 * Disconnect is a real teardown, not just a UI state flip: it evicts the
 * cached provider set and completes every deployment behind it, so the
 * in-memory secret key that derives this user's nullifier goes with it. That
 * is what makes reconnecting as a different wallet actually behave like a
 * different voter.
 */
export const Header: React.FC = () => {
  const { state, connect, disconnect } = useWalletConnection();

  return (
    <AppBar
      position="static"
      data-testid="header"
      sx={{
        backgroundColor: '#000',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          px: 10,
          py: 2.2,
          alignItems: 'center',
        }}
        data-testid="header-logo"
      >
        <img src="/midnight-logo.png" alt="logo-image" height={66} />
        <Typography variant="h6" sx={{ ml: 3, letterSpacing: '0.2em', color: 'primary.main' }}>
          QUORUM
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 10 }} data-testid="header-wallet">
        {state.status === 'connected' && (
          <Tooltip title={state.coinPublicKey}>
            <Typography
              data-testid="wallet-public-key"
              variant="body2"
              sx={{ fontFamily: 'monospace', color: 'primary.dark' }}
            >
              {abbreviate(state.coinPublicKey)}
            </Typography>
          </Tooltip>
        )}

        {state.status === 'failed' && (
          <Tooltip title={state.error.message}>
            <Typography data-testid="wallet-error" variant="body2" color="error">
              connection failed
            </Typography>
          </Tooltip>
        )}

        {state.status === 'connected' ? (
          <Button
            data-testid="wallet-disconnect-btn"
            variant="outlined"
            startIcon={<LogoutIcon />}
            onClick={disconnect}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            data-testid="wallet-connect-btn"
            variant="contained"
            disabled={state.status === 'connecting'}
            startIcon={state.status === 'connecting' ? <CircularProgress size={16} color="inherit" /> : <WalletIcon />}
            onClick={() => {
              void connect();
            }}
          >
            {state.status === 'connecting' ? 'Connecting…' : 'Connect Lace'}
          </Button>
        )}
      </Box>
    </AppBar>
  );
};
