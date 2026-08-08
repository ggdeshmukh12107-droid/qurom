// This file is part of Quorum.
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
import { Box, Chip, Collapse, Link, Table, TableBody, TableCell, TableRow, Tooltip, Typography } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { type QuorumDerivedState } from '../../../api/src/index';

/**
 * Makes the privacy claim observable rather than asserted.
 *
 * @remarks
 * The three facts shown here — this user's nullifier, whether they have voted,
 * and whether they are the organizer — are computed in the browser from the
 * secret key held in private state. They are *not* readable from the ledger.
 * Someone who reads the same contract with a different key sees the same
 * tally and a different nullifier, which is precisely the property that lets
 * the chain enforce one-person-one-vote without learning who voted.
 *
 * The nullifier is safe to display: it is a one-way hash of the secret key and
 * the round. Showing it is what makes the demonstration checkable — after
 * voting, this exact value appears in the public set, and it changes entirely
 * when the organizer starts a new round.
 */
export interface PrivacyPanelProps {
  state: QuorumDerivedState;
}

export const PrivacyPanel: React.FC<Readonly<PrivacyPanelProps>> = ({ state }) => {
  const [showTable, setShowTable] = useState(false);

  return (
    <Box
      data-testid="privacy-panel"
      sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <FingerprintIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" color="primary">
          Your private view
        </Typography>
      </Box>

      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="primary.dark" component="div">
          your nullifier this round (derived from your key, never sent)
        </Typography>
        <Tooltip title="A one-way hash of your secret key and the round number. The chain stores this, not your identity.">
          <Typography
            data-testid="privacy-nullifier"
            variant="body2"
            sx={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', color: 'primary.main' }}
          >
            {state.myNullifier}
          </Typography>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
        <Chip
          data-testid="privacy-has-voted"
          size="small"
          color={state.hasVoted ? 'success' : 'default'}
          label={state.hasVoted ? 'you have voted' : 'you have not voted'}
        />
        {state.isOrganizer && <Chip data-testid="privacy-is-organizer" size="small" label="you opened this poll" />}
        <Chip
          data-testid="privacy-nullifier-count"
          size="small"
          variant="outlined"
          label={`${state.nullifierCount.toString()} nullifier${state.nullifierCount === 1n ? '' : 's'} on-chain`}
        />
      </Box>

      {state.hasVoted && (
        <Typography
          data-testid="privacy-voted-note"
          variant="caption"
          color="primary.dark"
          sx={{ mt: 1.5, display: 'block' }}
        >
          Your nullifier is now in the public set above. The chain can prove a vote was cast and that it was not cast
          twice — it cannot show that it was yours.
        </Typography>
      )}

      <Link
        component="button"
        variant="caption"
        underline="hover"
        sx={{ mt: 1.5, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
        onClick={() => {
          setShowTable((shown) => !shown);
        }}
      >
        {showTable ? <VisibilityOffIcon fontSize="inherit" /> : <VisibilityIcon fontSize="inherit" />}
        {showTable ? 'hide' : 'what the chain sees'}
      </Link>

      <Collapse in={showTable}>
        <Table size="small" data-testid="privacy-table" sx={{ mt: 1 }}>
          <TableBody>
            {DISCLOSURE_ROWS.map((row) => (
              <TableRow key={row.value}>
                <TableCell sx={{ px: 0, py: 0.4, border: 0 }}>
                  <Typography variant="caption" color="primary">
                    {row.value}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ px: 0, py: 0.4, border: 0 }}>
                  <Typography variant="caption" color={row.onChain ? 'success.main' : 'error.main'}>
                    {row.onChain ? 'public' : 'never leaves your browser'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Collapse>
    </Box>
  );
};

/**
 * Mirrors the disclosure table in the README. Each `public` row corresponds to
 * a deliberate `disclose()` in the contract; the `secret key` row is the one
 * value that is never passed to `disclose()` anywhere in the circuit.
 *
 * @internal
 */
const DISCLOSURE_ROWS: ReadonlyArray<{ value: string; onChain: boolean }> = [
  { value: 'the question', onChain: true },
  { value: 'yes / no totals', onChain: true },
  { value: 'the set of nullifiers', onChain: true },
  { value: 'your secret key', onChain: false },
  { value: 'which way you voted', onChain: false },
  { value: 'the link between you and your vote', onChain: false },
];
